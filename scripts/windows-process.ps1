# Trusted process host. Request data is JSON, never PowerShell or cmd source.
$ErrorActionPreference = 'Stop'
try {
  $request = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:SYNERGY_PROCESS_REQUEST)) | ConvertFrom-Json
  Remove-Item Env:SYNERGY_PROCESS_REQUEST
  Add-Type -TypeDefinition @'
using System;
using System.Collections;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
public static class DashboardProcessHost {
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long a,b; public uint flags; public UIntPtr min,max; public uint count; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct EXT_LIMIT { public BASIC_LIMIT basic; public IO_COUNTERS io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUP { public uint cb; public string reserved,desktop,title; public uint x,y,w,h,cx,cy,fill,flags; public ushort show,reserved2; public IntPtr bytes,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct STARTUP_EX { public STARTUP startup; public IntPtr attributes; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int type,ref EXT_LIMIT info,uint length);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job,uint code);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr environment,string cwd,ref STARTUP_EX startup,out PROCESS process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr attribute,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint timeout);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr handle,out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr handle,uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool DuplicateHandle(IntPtr source,IntPtr handle,IntPtr target,out IntPtr copy,uint access,bool inherit,uint options);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle,uint mask,uint flags);
  static string Quote(string value) {
    var result = new StringBuilder("\""); int slashes = 0;
    foreach(char c in value) {
      if(c == '\\') { slashes++; continue; }
      if(c == '"') result.Append('\\',slashes*2+1).Append('"');
      else result.Append('\\',slashes).Append(c);
      slashes=0;
    }
    return result.Append('\\',slashes*2).Append('"').ToString();
  }
  static IntPtr CopyStandard(int id) {
    IntPtr copy;
    if(!DuplicateHandle(GetCurrentProcess(),GetStdHandle(id),GetCurrentProcess(),out copy,0,true,2)) throw new Win32Exception();
    return copy;
  }
  public static int Run(string command,string[] args,string cwd,int parentId,string lockFile) {
    IntPtr job=IntPtr.Zero, block=IntPtr.Zero, jobList=IntPtr.Zero;
    var pi=new PROCESS(); var sx=new STARTUP_EX(); FileStream held=null;
    Process parent=null;
    try {
      parent=Process.GetProcessById(parentId);
      if(parent.HasExited) return 1;
      if(!String.IsNullOrEmpty(lockFile)) {
        try { held=new FileStream(lockFile,FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None); }
        catch(IOException e) { if((e.HResult & 0xffff)==32 || (e.HResult & 0xffff)==33) return 75; throw; }
        // Keep the lock alive in the worker even if this host is forcibly terminated.
        if(!SetHandleInformation(held.SafeFileHandle.DangerousGetHandle(),1,1)) throw new Win32Exception();
      }
      job=CreateJobObject(IntPtr.Zero,null);
      if(job==IntPtr.Zero) throw new Win32Exception();
      var limit=new EXT_LIMIT(); limit.basic.flags=0x2000; // KILL_ON_JOB_CLOSE, no breakaway
      if(!SetInformationJobObject(job,9,ref limit,(uint)Marshal.SizeOf(limit))) throw new Win32Exception();
      sx.startup.cb=(uint)Marshal.SizeOf(sx); sx.startup.flags=0x100;
      sx.startup.input=CopyStandard(-10); sx.startup.output=CopyStandard(-11); sx.startup.error=CopyStandard(-12);
      IntPtr size=IntPtr.Zero;
      InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);
      sx.attributes=Marshal.AllocHGlobal(size);
      if(!InitializeProcThreadAttributeList(sx.attributes,1,0,ref size)) throw new Win32Exception();
      jobList=Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList,job);
      // Atomic assignment at creation prevents an orphan if the host is killed between create and assign.
      if(!UpdateProcThreadAttribute(sx.attributes,0,new IntPtr(0x2000D),jobList,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero)) throw new Win32Exception();
      var line=new StringBuilder(Quote(command)); foreach(var arg in args) line.Append(' ').Append(Quote(arg));
      var variables=new SortedList(StringComparer.OrdinalIgnoreCase);
      foreach(DictionaryEntry item in Environment.GetEnvironmentVariables()) variables[item.Key]=item.Value;
      var environment=new StringBuilder(); foreach(DictionaryEntry item in variables) environment.Append(item.Key).Append('=').Append(item.Value).Append('\0');
      block=Marshal.StringToHGlobalUni(environment.Append('\0').ToString());
      if(!CreateProcess(command,line,IntPtr.Zero,IntPtr.Zero,true,0x08080404,block,cwd,ref sx,out pi)) throw new Win32Exception();
      var watchedJob=job;
      var monitor=new Thread(()=>{ try { parent.WaitForExit(); TerminateJobObject(watchedJob,1); } catch {} });
      monitor.IsBackground=true; monitor.Start();
      if(ResumeThread(pi.thread)==0xffffffff) throw new Win32Exception();
      WaitForSingleObject(pi.process,0xffffffff);
      uint code; GetExitCodeProcess(pi.process,out code);
      TerminateJobObject(job,1); // root exited: also terminate remaining descendants
      return unchecked((int)code);
    } finally {
      if(job!=IntPtr.Zero) { TerminateJobObject(job,1); CloseHandle(job); }
      if(pi.process!=IntPtr.Zero) { WaitForSingleObject(pi.process,10000); CloseHandle(pi.process); }
      if(pi.thread!=IntPtr.Zero) CloseHandle(pi.thread);
      if(sx.startup.input!=IntPtr.Zero) CloseHandle(sx.startup.input);
      if(sx.startup.output!=IntPtr.Zero) CloseHandle(sx.startup.output);
      if(sx.startup.error!=IntPtr.Zero) CloseHandle(sx.startup.error);
      if(sx.attributes!=IntPtr.Zero) { DeleteProcThreadAttributeList(sx.attributes); Marshal.FreeHGlobal(sx.attributes); }
      if(jobList!=IntPtr.Zero) Marshal.FreeHGlobal(jobList);
      if(block!=IntPtr.Zero) Marshal.FreeHGlobal(block);
      if(held!=null) held.Dispose();
    }
  }
}
'@
  exit [DashboardProcessHost]::Run([string]$request.command, [string[]]$request.args, [string]$request.cwd, [int]$request.parent, [string]$request.lockFile)
} catch {
  [Console]::Error.WriteLine('WINDOWS_PROCESS_FAILED')
  exit 1
}
