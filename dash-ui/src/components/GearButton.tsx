import { useNavigate } from 'react-router-dom';

const GearButton = () => {
  const navigate = useNavigate();

  return (
    <button
      type="button"
      onClick={() => navigate('/config')}
      className="rounded-full bg-white/20 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur transition hover:bg-white/30 focus:outline-none focus:ring-2 focus:ring-white/60 focus:ring-offset-2 focus:ring-offset-black/20"
    >
      ⚙ Ajustes
    </button>
  );
};

export default GearButton;
