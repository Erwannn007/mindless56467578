// Start screen, pause menu, discovery toasts and the small perf readout.

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(settings, handlers) {
    this.s = settings;
    this.h = handlers;
    this.toastTimer = 0;

    $('btn-start').addEventListener('click', () => handlers.start());
    $('btn-menu').addEventListener('click', () => handlers.pause());
    $('btn-resume').addEventListener('click', () => handlers.resume());
    const run = $('btn-run');
    run.addEventListener('click', () => {
      run.classList.toggle('on');
      handlers.setRun(run.classList.contains('on'));
    });

    const time = $('opt-time');
    time.addEventListener('input', () => { settings.timeOfDay = +time.value; });
    const daylen = $('opt-daylen');
    daylen.addEventListener('input', () => { settings.dayLength = +daylen.value; this._daylenLabel(); });
    const sens = $('opt-sens');
    sens.addEventListener('input', () => { settings.sensitivity = +sens.value; handlers.applySettings(); });
    const quality = $('opt-quality');
    quality.addEventListener('change', () => { settings.quality = quality.value; handlers.applyQuality(); });
    const bob = $('opt-bob');
    bob.addEventListener('change', () => { settings.headBob = bob.checked; handlers.applySettings(); });
    const stats = $('opt-stats');
    stats.addEventListener('change', () => { settings.showStats = stats.checked; $('stats').hidden = !stats.checked; });
    $('btn-seed').addEventListener('click', () => {
      const v = $('opt-seed').value.trim();
      const seed = v && v !== settings.seed ? v : Math.random().toString(36).slice(2, 9);
      $('opt-seed').value = seed;
      handlers.newWorld(seed);
    });
  }

  _daylenLabel() { $('opt-daylen-v').textContent = `(${this.s.dayLength} min)`; }

  ready() {
    $('loading').hidden = true;
    $('btn-start').hidden = false;
  }

  loading(text) { $('loading').textContent = text; }

  showGame() {
    $('start').hidden = true;
    $('menu').hidden = true;
    $('hud').hidden = false;
  }

  showMenu(discoveredCount) {
    const s = this.s;
    $('opt-time').value = s.timeOfDay;
    $('opt-daylen').value = s.dayLength;
    $('opt-sens').value = s.sensitivity;
    $('opt-quality').value = s.quality;
    $('opt-bob').checked = s.headBob !== false;
    $('opt-stats').checked = !!s.showStats;
    $('opt-seed').value = s.seed;
    this._daylenLabel();
    $('discoveries').textContent = discoveredCount
      ? `Lieux découverts dans ce monde : ${discoveredCount}`
      : 'Aucun lieu découvert pour l’instant. Les ruines et arches se cachent au loin…';
    $('menu').hidden = false;
  }

  toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => t.classList.remove('show'), 3800);
  }

  stats(text) {
    if (this.s.showStats) $('stats').textContent = text;
  }
}
