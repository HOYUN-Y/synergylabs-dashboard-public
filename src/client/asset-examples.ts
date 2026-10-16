export const assetTypes = ['3D 오브젝트', '인포그래픽', '모션 레시피', '히어로 카운터', '배경', '아이콘', '효과음'] as const;

export interface AssetExample {
  id: string;
  name: string;
  type: typeof assetTypes[number];
  description: string;
  tags: string[];
  preview: 'counter' | 'chart' | 'background' | 'motion';
}

export const assetExamples: AssetExample[] = [
  { id: 'hero-counter-basic', name: '기본 히어로 카운터', type: '히어로 카운터', description: '큰 숫자와 단위로 핵심 성과를 강조하는 카운터입니다.', tags: ['숫자', '성과', 'counter'], preview: 'counter' },
  { id: 'bar-chart-basic', name: '기본 막대그래프', type: '인포그래픽', description: '세 항목의 수치를 한눈에 비교하는 간결한 차트입니다.', tags: ['데이터', '비교', 'chart'], preview: 'chart' },
  { id: 'gradient-background-basic', name: '그라디언트 배경', type: '배경', description: '주황색과 짙은 회색으로 장면에 깊이를 더하는 배경입니다.', tags: ['그라디언트', 'gradient', 'background'], preview: 'background' },
  { id: 'slide-up-entrance-basic', name: '슬라이드 업 등장', type: '모션 레시피', description: '문구가 아래에서 올라오는 등장 효과의 예시입니다.', tags: ['등장', '타이포그래피', 'motion'], preview: 'motion' }
];

export function assetCopyText(asset: AssetExample): string {
  return `에셋 인터페이스 예시\n이름: ${asset.name}\n유형: ${asset.type}\n설명: ${asset.description}\n태그: ${asset.tags.join(', ')}\n\n이 정보는 화면 확인용 예시입니다. 실제 에셋 원본은 연결되지 않았으며 사용 가능한 파일 경로·라이선스는 제공하지 않습니다.`;
}
