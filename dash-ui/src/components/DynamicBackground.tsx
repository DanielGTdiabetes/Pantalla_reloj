import { motion, AnimatePresence } from 'framer-motion';
import { useBackgroundCycle } from '../hooks/useBackgroundCycle';
import { ENABLE_WEBGL } from '../utils/runtimeFlags';

interface DynamicBackgroundProps {
  refreshMinutes?: number;
}

const DynamicBackground = ({ refreshMinutes }: DynamicBackgroundProps) => {
  const { current, previous, cycleKey, isCrossfading } = useBackgroundCycle(refreshMinutes);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <AnimatePresence mode="sync">
        {previous && (
          <motion.div
            key={`prev-${previous.generatedAt}`}
            className="absolute inset-0 fade-layer"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeInOut' }}
            style={{
              backgroundImage: `url(${previous.url})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'saturate(110%) contrast(105%)',
            }}
          />
        )}
        {current.url && (
          <motion.div
            key={`current-${cycleKey}`}
            className="absolute inset-0 fade-layer"
            initial={{ opacity: isCrossfading ? 0 : 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeInOut' }}
            style={{
              backgroundImage: `url(${current.url})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: ENABLE_WEBGL ? 'saturate(118%) contrast(110%)' : 'saturate(110%) contrast(105%)',
            }}
          />
        )}
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-br from-black/65 via-black/35 to-black/75" aria-hidden />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 20% 20%, rgba(56, 249, 255, 0.18), transparent 55%)' }} aria-hidden />
    </div>
  );
};

export default DynamicBackground;
