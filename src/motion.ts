import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export function initMotion() {
  const media = gsap.matchMedia();
  media.add('(prefers-reduced-motion: no-preference)', () => {
    gsap.timeline({ defaults: { ease: 'power3.out' } })
      .from('.title-line > span', { yPercent: 110, rotation: 2, stagger: .12, duration: 1.2 }, .1)
      .from('.hero-intro', { opacity: 0, y: 20, stagger: .13, duration: .85 }, .65)
      .from('.portal-coordinate', { opacity: 0, duration: 1.4 }, 1.1);
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
  });
}

export function setPlaying(playing: boolean) {
  document.body.classList.toggle('is-playing', playing);
  document.dispatchEvent(new Event('gameplaychange'));
}
