import GlassPanel from '../GlassPanel';
import type { DayInfoPayload } from '../../services/dayinfo';

interface InfoPanelProps {
  dayInfo?: DayInfoPayload | null;
}

const InfoPanel = ({ dayInfo }: InfoPanelProps) => {
  if (!dayInfo) {
    return (
      <GlassPanel className="justify-center text-center text-white/75">
        <div className="text-2xl">Preparando información…</div>
      </GlassPanel>
    );
  }

  const efemeride = dayInfo.efemerides?.[0];
  const santoral = dayInfo.santoral?.map((item) => item.name).join(', ');
  const holiday = dayInfo.holiday?.is_holiday ? dayInfo.holiday.name : null;
  const patronName = dayInfo.patron?.name?.trim();
  const patronPlace = dayInfo.patron?.place?.trim();
  const patron = patronName ? (patronPlace ? `${patronName} (${patronPlace})` : patronName) : null;

  return (
    <GlassPanel className="justify-between">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-xs uppercase tracking-[0.3em] text-white/45">Efeméride</h2>
          <p className="mt-2 text-lg leading-tight text-white/85">
            {efemeride?.text ?? 'Sin efemérides destacadas.'}
          </p>
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-[0.3em] text-white/45">Santoral</h2>
          <p className="mt-2 text-base text-white/80">{santoral ?? 'Sin datos.'}</p>
        </div>
      </div>
      <div className="space-y-2 text-sm text-white/75">
        {holiday ? (
          <div>
            <span className="text-white/60">Festivo:</span> {holiday}
          </div>
        ) : (
          <div className="text-white/45">Hoy no es festivo</div>
        )}
        {patron ? (
          <div>
            <span className="text-white/60">Patrón:</span> {patron}
          </div>
        ) : null}
      </div>
    </GlassPanel>
  );
};

export default InfoPanel;
