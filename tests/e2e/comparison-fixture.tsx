import { createRoot } from 'react-dom/client';
import SimpleComparison from '../../src/components/SimpleComparison';
import { defaultConfig } from '../../src/sim/config';
const config = {
  ...defaultConfig(),
  floors: 5,
  cars: 2,
  duration: 30,
  rate: 8,
  initialQueues: [0, 0, 0, 0, 0],
};
createRoot(document.getElementById('comparison-fixture')!).render(
  <SimpleComparison config={config} />,
);
