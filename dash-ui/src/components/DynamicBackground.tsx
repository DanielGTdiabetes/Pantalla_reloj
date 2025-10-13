import { motion, AnimatePresence } from 'framer-motion';
import { useDynamicBackground } from '../hooks/useDynamicBackground';

interface DynamicBackgroundProps {
  refreshMinutes?: number;
}

const DynamicBackground = ({ refreshMinutes }: DynamicBackgroundProps) => {
  const background = useDynamicBackground(refreshMinutes);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <AnimatePresence mode="wait">
        {background.url && (
          <motion.div
            key={background.url}
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: 'easeInOut' }}
            style={{
              backgroundImage: `url(${background.url})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'saturate(110%) contrast(105%)',
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
