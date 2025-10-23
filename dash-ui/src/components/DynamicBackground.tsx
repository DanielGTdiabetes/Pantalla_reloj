import { motion, AnimatePresence } from 'framer-motion';
import { buildVersionedSrc, useBackgroundCycle } from '../hooks/useBackgroundCycle';
import { ENABLE_WEBGL } from '../utils/runtimeFlags';

interface DynamicBackgroundProps {
  refreshMinutes?: number;
}

const DynamicBackground = ({ refreshMinutes }: DynamicBackgroundProps) => {
  const { current, previous, cycleKey, isCrossfading } = useBackgroundCycle(refreshMinutes);

  const currentSrc = current ? buildVersionedSrc(current) : '';
  const previousSrc = previous ? buildVersionedSrc(previous) : '';

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <AnimatePresence mode="sync">
        {previous && previousSrc && (
          <motion.img
            key={`prev-${previous.generatedAt}-${previous.etag ?? 'none'}`}
            className="fixed inset-0 h-full w-full object-cover fade-layer"
            src={previousSrc}
            alt=""
            aria-hidden
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeInOut' }}
            style={{ filter: 'saturate(110%) contrast(105%)' }}
          />
        )}
        {currentSrc && (
          <motion.img
            key={`current-${cycleKey}-${current.etag ?? current.generatedAt}`}
            className="fixed inset-0 h-full w-full object-cover fade-layer"
            src={currentSrc}
            alt=""
            aria-hidden
            initial={{ opacity: isCrossfading ? 0 : 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeInOut' }}
            style={{
              filter: ENABLE_WEBGL ? 'saturate(118%) contrast(110%)' : 'saturate(110%) contrast(105%)',
            }}
          />
        )}
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-br from-black/15 via-black/10 to-black/25" aria-hidden />
      <div className="absolute inset-0" style={{ background: 'radial-gradient(circle at 20% 20%, rgba(56, 249, 255, 0.18), transparent 55%)' }} aria-hidden />
    </div>
  );
};

export default DynamicBackground;
