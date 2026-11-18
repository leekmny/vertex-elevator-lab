# 실제 실행 벤치마크

측정: 2026-11-18T05:42:16.267Z

환경: AMD Ryzen 7 260 w/ Radeon 780M Graphics        , v26.13.1, win32. 렌더링·Worker 직렬화 제외. 시간은 장비와 실행 부하에 따라 달라진다.

## 처리 속도

| 층 | 차량 | 혼잡도 | 120초 수요 인원 | 사건 수 | 3회 중앙 실행시간 ms | 보존 검사 |
|---|---|---|---|---|---|---|
| 5 | 1 | 0% | 0 | 13 | 0.124 | true |
| 20 | 2 | 100% | 41 | 277 | 1.132 | true |
| 100 | 20 | 500% | 232 | 929 | 14.768 | true |

## 예제: ETA, 20층, 24명/분, 600초

Seed 2026·11999·21972, Drain 미사용. 세 Seed 평균이며 미완료 승객을 함께 제시한다.

| 차량 | 평균 대기 s | P95 대기 s | 완료 명/분 | 미완료 명 |
|---|---|---|---|---|
| 1 | 141.39 | 329.04 | 9.40 | 143.33 |
| 2 | 115.34 | 261.48 | 14.20 | 95.33 |
| 4 | 64.10 | 187.46 | 18.73 | 50.00 |
| 8 | 29.33 | 88.05 | 21.50 | 22.33 |
| 12 | 19.47 | 58.95 | 22.40 | 13.33 |

대기 평균은 탑승 관측 표본이다. 과부하에서는 미완료 승객이 증가하고 관측 선택 편향이 있으므로 평균만으로 평가하지 않는다. 전체 신뢰구간과 조건은 [benchmark.json](benchmark.json), [예제 결과](../examples/scaling-result.json), [HTML 보고서](../examples/scaling-report.html)에 있다. 포화 sweep은 2대·100/300/500%·300초·LOOK/ETA를 각3회 반복했다. 이 유한 시간 관측으로 점근 용량을 확정하지 않는다.

## Finite-horizon saturation observations

20 floors, 2 cars, 300 seconds, 3 paired seeds.

- look: maximum observed throughput 20.07 passengers/min; first tested demand with queue-growth 95% CI lower bound > 0: 300%.
- eta: maximum observed throughput 19.13 passengers/min; first tested demand with queue-growth 95% CI lower bound > 0: 100%.

No bounded threshold is inferred without an earlier point whose upper CI is <= 0. These finite observations do not establish sustainable capacity.
