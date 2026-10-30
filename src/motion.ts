import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function initMotion() {
  const media = gsap.matchMedia();
  media.add('(prefers-reduced-motion: no-preference)', () => {
    gsap.timeline({ defaults: { ease: 'power3.out' } })
      .from('.hero-image', { scale: 1.17, duration: 2.3 }, 0)
      .from('.title-line > span', { yPercent: 110, rotation: 2, stagger: .12, duration: 1.2 }, .1)
      .from('.hero-intro', { opacity: 0, y: 20, stagger: .13, duration: .85 }, .65)
      .from('.portal-coordinate', { opacity: 0, duration: 1.4 }, 1.1);
    gsap.to('.hero-image', { yPercent: 12, ease: 'none', scrollTrigger: {
      trigger: '.hero', start: 'top top', end: 'bottom top', scrub: .7
    }});
    gsap.to('.scroll-progress', { scaleX: 1, ease: 'none', scrollTrigger: {
      trigger: document.body, start: 'top top', end: 'bottom bottom', scrub: .2
    }});
    gsap.utils.toArray<HTMLElement>('.reveal').forEach(section => {
      gsap.from(section, { opacity: 0, y: 38, duration: .95, ease: 'power2.out',
        onComplete: () => { gsap.set(section, { clearProps: 'transform,opacity' }); },
        scrollTrigger: { trigger: section, start: 'top 92%', once: true } });
    });
    const art = document.querySelector<HTMLElement>('.hero-art')!;
    const x = gsap.quickTo(art, 'x', { duration: 1.4, ease: 'power2.out' });
    const hero = document.querySelector<HTMLElement>('.hero')!;
    hero.addEventListener('pointermove', event => {
      if (event.pointerType === 'mouse') x((event.clientX / innerWidth - .5) * 16);
    });
    hero.addEventListener('pointerleave', () => x(0));
    document.querySelectorAll<HTMLElement>('.magnetic').forEach(button => {
      button.addEventListener('pointermove', event => {
        if (event.pointerType !== 'mouse') return;
        const rect = button.getBoundingClientRect();
        gsap.to(button, { x: (event.clientX - rect.left - rect.width / 2) * .06,
          y: (event.clientY - rect.top - rect.height / 2) * .06, duration: .35 });
      });
      button.addEventListener('pointerleave', () => gsap.to(button, { x: 0, y: 0, duration: .5 }));
    });
    initFireflies();
  });
}

function initFireflies() {
  const canvas = document.getElementById('fireflies') as HTMLCanvasElement;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const hero = document.querySelector('.hero')!;
  const dots = Array.from({ length: innerWidth < 760 ? 18 : 42 }, () => ({
    x: Math.random(), y: .18 + Math.random() * .74, phase: Math.random() * 8,
    size: .5 + Math.random() * 1.2, speed: .2 + Math.random() * .8
  }));
  let visible = true, scheduled = false, previous = 0;
  const resize = () => {
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(canvas.clientWidth * ratio);
    canvas.height = Math.round(canvas.clientHeight * ratio);
  };
  const shouldRun = () => visible && !document.hidden && !document.body.classList.contains('is-playing');
  const schedule = () => { if (!scheduled && shouldRun()) { scheduled = true; requestAnimationFrame(frame); } };
  const frame = (time: number) => {
    scheduled = false;
    if (!shouldRun()) return;
    if (time - previous > 32) {
      previous = time;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dots.forEach(dot => {
        const t = time * .00018 * dot.speed;
        const x = (dot.x + Math.sin(t + dot.phase) * .035) * canvas.width;
        const y = (dot.y + Math.cos(t * .8 + dot.phase) * .025) * canvas.height;
        ctx.fillStyle = `rgba(244,226,157,${.18 + (Math.sin(t * 3 + dot.phase) + 1) * .25})`;
        ctx.beginPath(); ctx.arc(x, y, dot.size, 0, Math.PI * 2); ctx.fill();
      });
    }
    schedule();
  };
  new ResizeObserver(resize).observe(canvas);
  new IntersectionObserver(entries => { visible = entries[0].isIntersecting; schedule(); }).observe(hero);
  document.addEventListener('visibilitychange', schedule);
  document.addEventListener('gameplaychange', schedule);
  resize(); schedule();
}

export function setPlaying(playing: boolean) {
  document.body.classList.toggle('is-playing', playing);
  document.dispatchEvent(new Event('gameplaychange'));
}
