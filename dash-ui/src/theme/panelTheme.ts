export type PanelTimeOfDay = 'night' | 'dawn' | 'day' | 'dusk';

export function getPanelTimeOfDay(now: Date): PanelTimeOfDay {
  const h = now.getHours();
  if (h < 6) return 'night';
  if (h < 9) return 'dawn';
  if (h < 19) return 'day';
  if (h < 22) return 'dusk';
  return 'night';
}

export function getPanelBackgroundClass(timeOfDay: PanelTimeOfDay): string {
  switch (timeOfDay) {
    case 'night':
      return 'panel-bg-night';
    case 'dawn':
      return 'panel-bg-dawn';
    case 'day':
      return 'panel-bg-day';
    case 'dusk':
      return 'panel-bg-dusk';
    default:
      return 'panel-bg-night';
  }
}
