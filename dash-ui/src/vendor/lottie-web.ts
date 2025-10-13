export interface AnimationConfig {
  container: HTMLElement;
  animationData?: { nm?: string };
  renderer?: 'svg';
  loop?: boolean;
  autoplay?: boolean;
}

export interface AnimationItem {
  destroy(): void;
}

const STYLE_ID = '__dash_lottie_stub__';

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .dash-lottie-icon {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dash-lottie-icon svg {
      width: 100%;
      height: 100%;
    }
    @keyframes dash-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes dash-bounce {
      0%, 100% { transform: translateY(0); opacity: 0.85; }
      50% { transform: translateY(8px); opacity: 1; }
    }
    @keyframes dash-flash {
      0%, 100% { opacity: 0; }
      20% { opacity: 1; }
      60% { opacity: 0.4; }
    }
  `;
  document.head.appendChild(style);
}

function createSvg(name: string): SVGSVGElement {
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('fill', 'none');

  if (name === 'weather-sun') {
    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', '100');
    circle.setAttribute('cy', '100');
    circle.setAttribute('r', '34');
    circle.setAttribute('fill', '#FFD166');
    svg.appendChild(circle);
    for (let i = 0; i < 8; i += 1) {
      const ray = document.createElementNS(svgNS, 'rect');
      ray.setAttribute('x', '98');
      ray.setAttribute('y', '30');
      ray.setAttribute('width', '4');
      ray.setAttribute('height', '26');
      ray.setAttribute('fill', '#F6AE2D');
      ray.setAttribute('transform', `rotate(${i * 45} 100 100)`);
      svg.appendChild(ray);
    }
    svg.style.animation = 'dash-rotate 6s linear infinite';
  } else if (name === 'weather-rain') {
    const cloud = document.createElementNS(svgNS, 'path');
    cloud.setAttribute('d', 'M60 110c-12 0-22-10-22-22s10-22 22-22c4 0 8 1 11 3 6-11 18-19 31-19 20 0 36 16 36 36 0 1 0 2-0.1 3 8 1 15 7 15 16 0 9-7 16-16 16H60z');
    cloud.setAttribute('fill', '#C8D5F0');
    svg.appendChild(cloud);
    const drops = [70, 100, 130];
    drops.forEach((x, index) => {
      const drop = document.createElementNS(svgNS, 'path');
      drop.setAttribute('d', 'M0 0c8 12 8 24 0 32 0 0-8-8-8-16S0 0 0 0z');
      drop.setAttribute('fill', '#5DA9FF');
      drop.setAttribute('transform', `translate(${x} 130)`);
      drop.style.transformOrigin = `${x}px 130px`;
      drop.style.animation = `dash-bounce 1.2s ${index * 0.2}s ease-in-out infinite`;
      svg.appendChild(drop);
    });
  } else if (name === 'weather-cloud') {
    const cloud = document.createElementNS(svgNS, 'path');
    cloud.setAttribute('d', 'M50 120c-14 0-26-12-26-26s12-26 26-26c5 0 9 1 13 4 7-13 21-22 37-22 23 0 42 19 42 42 0 1 0 3-0.2 4 9 1 16 8 16 18 0 10-8 18-18 18H50z');
    cloud.setAttribute('fill', '#D7E2F5');
    svg.appendChild(cloud);
  } else {
    const cloud = document.createElementNS(svgNS, 'path');
    cloud.setAttribute('d', 'M58 118c-12 0-22-10-22-22s10-22 22-22c5 0 9 2 12 4 6-12 18-20 32-20 21 0 38 17 38 38 0 1 0 2-0.1 3 9 1 16 8 16 18 0 10-8 18-18 18H58z');
    cloud.setAttribute('fill', '#9FA9BD');
    svg.appendChild(cloud);
    const bolt = document.createElementNS(svgNS, 'polygon');
    bolt.setAttribute('points', '100,120 120,120 102,162 130,162 92,210 98,168 78,168');
    bolt.setAttribute('fill', '#FFD166');
    bolt.style.animation = 'dash-flash 1.4s ease-in-out infinite';
    svg.appendChild(bolt);
  }

  return svg;
}

export function loadAnimation(config: AnimationConfig): AnimationItem {
  ensureStyles();
  const { container, animationData } = config;
  if (!container) {
    throw new Error('Lottie stub requires a container');
  }
  const name = animationData?.nm ?? 'weather-sun';
  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'dash-lottie-icon';
  wrapper.appendChild(createSvg(name));
  container.appendChild(wrapper);
  return {
    destroy() {
      if (container.contains(wrapper)) {
        container.removeChild(wrapper);
      }
    },
  };
}
