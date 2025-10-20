import DynamicBackground from './DynamicBackground';

interface BackgroundProps {
  refreshMinutes?: number;
}

const Background = ({ refreshMinutes }: BackgroundProps) => (
  <div className="pointer-events-none absolute inset-0">
    <DynamicBackground refreshMinutes={refreshMinutes} />
  </div>
);

export default Background;
