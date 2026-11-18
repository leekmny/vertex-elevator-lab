import { Lightbulb, Check, Info } from 'lucide-react';
import type { AlgorithmId, Scenario } from '../sim/types';
export const SIMPLE_ALGORITHM_NAMES: Record<AlgorithmId, string> = {
  fcfs: '먼저 누른 호출부터 · FCFS',
  nearest: '가장 가까운 차 · Nearest',
  direction: '같은 방향의 가까운 차',
  collective: '같은 방향끼리 함께 운행',
  look: '호출이 있는 곳까지만 · LOOK',
  scan: '끝층까지 갔다가 돌아오기 · SCAN',
  eta: '먼저 도착할 차 찾기 · ETA',
  journey: '전체 이동시간 함께 고려',
  static: '구역을 나누어 담당하기',
  dynamic: '붐비는 쪽으로 구역 바꾸기',
  destination: '목적지별로 모아 태우기',
  multi: '여러 기준을 균형 있게',
  genetic: '배차 조합을 섞어 탐색 · GA',
  annealing: '배차를 조금씩 바꾸어 탐색 · SA',
};
export const SCENARIO_NAMES: Record<Scenario, string> = {
  random: '자유로운 층간 이동',
  downpeak: '아래층(로비)으로 집중',
  uppeak: '위층으로 집중',
  simultaneous: '모든 층 동시 호출',
  overload: '많은 승객이 계속 등장',
  hotspot: '특정 층에 승객 집중',
  lobby: '로비에서 출발',
  interfloor: '다양한 층 사이 이동',
  failure: '차량 안전 퇴역 실험',
  changing: '시간에 따라 바뀌는 수요',
  custom: '직접 설정한 승객 패턴',
};
const EXPLANATIONS: Record<
  AlgorithmId,
  { title: string; how: string; good: string; limit: string }
> = {
  fcfs: {
    title: '먼저 누른 호출부터',
    how: '먼저 버튼을 누른 사람의 호출을 우선합니다. 줄을 선 순서대로 차례를 지키는 방식이에요.',
    good: '순서를 이해하기 쉽고 먼저 온 사람을 챙깁니다.',
    limit: '이동 동선이 겹쳐 멀리 돌아갈 수 있어요.',
  },
  nearest: {
    title: '가장 가까운 엘리베이터',
    how: '누군가 호출하면 현재 그 층에 가장 가까운 엘리베이터를 보냅니다.',
    good: '가까운 차가 빠르게 응답할 수 있어요.',
    limit: '차가 가는 방향과 이미 잡힌 정차 때문에 늦어질 수 있어요.',
  },
  direction: {
    title: '가깝고, 같은 방향인 차',
    how: '현재 거리와 함께 가는 방향도 확인합니다. 위로 가려는 사람에게 위로 가는 차를 우선 보냅니다.',
    good: '반대로 돌아가는 운행을 줄입니다.',
    limit: '차 안에 있는 승객과 정차가 많으면 늦어질 수 있어요.',
  },
  collective: {
    title: '같은 방향의 호출을 함께',
    how: '위로 가는 호출끼리, 아래로 가는 호출끼리 모아서 순서대로 들릅니다.',
    good: '방향이 맞는 승객을 함께 태울 수 있어요.',
    limit: '반대 방향의 호출은 더 기다릴 수 있어요.',
  },
  look: {
    title: '부른 사람이 있는 곳까지만',
    how: '현재 방향으로 이동하면서 호출이 있는 마지막 층까지만 갑니다. 더 위에 호출이 없으면 바로 방향을 바꿉니다.',
    good: '부른 사람이 없는 구간의 이동을 줄입니다.',
    limit: '한쪽 방향에 호출이 몰리면 반대편이 기다려요.',
  },
  scan: {
    title: '끝층까지 갔다가 돌아오기',
    how: '정해진 운행 범위의 끝까지 간 뒤 방향을 바꿉니다. LOOK과 빈 구간 이동 차이를 살펴보세요.',
    good: '일정한 방향 순회 규칙이 있어요.',
    limit: '아무도 없는 끝층까지 가는 이동이 생깁니다.',
  },
  eta: {
    title: '먼저 도착할 수 있는 차',
    how: '단순한 거리뿐 아니라 이동 속도, 가속, 예정된 정차까지 생각해 빨리 도착할 차를 고릅니다.',
    good: '가깝더라도 바쁜 차는 피할 수 있어요.',
    limit: '앞으로 생길 호출까지 완벽히 알 수는 없어요.',
  },
  journey: {
    title: '전체 여정도 함께 생각하기',
    how: '차가 도착할 시간과 탑승 후 예상 이동시간을 합쳐 비교합니다. 목적지는 탑승 전에는 몰라서 방향으로 추정해요.',
    good: '기다림과 이동을 함께 고려합니다.',
    limit: '목적지 추정이 실제 이동과 다를 수 있어요.',
  },
  static: {
    title: '구역을 나누어 맡기기',
    how: '저층과 고층처럼 담당 구역을 정합니다. 각 구역 안에서 도착하기 좋은 차를 고릅니다.',
    good: '여러 차가 같은 층에 몰리는 일을 줄입니다.',
    limit: '다른 구역으로 가면 로비 환승이 필요할 수 있어요.',
  },
  dynamic: {
    title: '붐비는 쪽으로 담당 바꾸기',
    how: '기다리는 사람이 많은 층을 살펴보고 30초마다 담당 구역 경계를 바꿉니다. 이미 탄 승객의 하차는 지킵니다.',
    good: '한쪽 구역이 갑자기 붐빌 때 대응합니다.',
    limit: '담당 구역이 바뀌며 환승과 지연이 생길 수 있어요.',
  },
  destination: {
    title: '미리 목적지를 알고 묶기',
    how: '타기 전에 가려는 층을 입력받고 비슷한 목적지의 사람을 묶습니다. 다른 방식보다 사전 정보가 많아요.',
    good: '같은 목적지로 가는 승객을 모을 수 있어요.',
    limit: '목적지를 모르는 일반 호출과 조건이 다릅니다.',
  },
  multi: {
    title: '여러 기준을 균형 있게',
    how: '대기시간, 이동시간, 오래 기다린 사람, 차량 부하와 이동 비용을 함께 비교합니다.',
    good: '한 가지 숫자에만 치우치지 않아요.',
    limit: '무엇을 더 중요하게 보는지에 따라 결과가 달라져요.',
  },
  genetic: {
    title: '여러 배차 조합을 골라 보기',
    how: '여러 배차 후보를 만들고, 좋은 조합을 섞고 바꾸며 실제 비용이 작은 조합을 탐색합니다.',
    good: '단순히 가까운 차를 고르는 것과 다른 조합을 찾아요.',
    limit: '탐색 횟수가 한정되어 최고 조합을 보장하지는 않아요.',
  },
  annealing: {
    title: '조금씩 바꾸며 좋은 배차 찾기',
    how: '배차 조합을 조금씩 바꾸어 비용을 비교합니다. 막다른 선택에서 벗어나도록 가끔 다른 후보도 시도합니다.',
    good: '현재 선택보다 나은 조합을 탐색해요.',
    limit: '정해진 횟수만 탐색하므로 항상 최고는 아닙니다.',
  },
};
export function AlgorithmExplanation({ algorithm }: { algorithm: AlgorithmId }) {
  const e = EXPLANATIONS[algorithm];
  return (
    <section className="simple-explanation" data-testid="algorithm-explanation">
      <div className="simple-explanation-icon">
        <Lightbulb size={18} />
        <span>이 알고리즘은요</span>
      </div>
      <h2>{e.title}</h2>
      <p>{e.how}</p>
      <div className="simple-explanation-point">
        <Check size={14} />
        <span>{e.good}</span>
      </div>
      <div className="simple-explanation-point muted">
        <Info size={14} />
        <span>{e.limit}</span>
      </div>
    </section>
  );
}
