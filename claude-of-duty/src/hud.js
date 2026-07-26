// DOM-based heads-up display: health, ammo, crosshair, hit markers,
// kill feed, wave announcements, damage direction arrows and menus.

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.root = $("hud");
    this.healthFill = $("health-fill");
    this.healthNum = $("health-num");
    this.lowhp = $("lowhp");
    this.ammoMag = $("ammo-mag");
    this.ammoReserve = $("ammo-reserve");
    this.weaponName = $("weapon-name");
    this.weaponSlots = $("weapon-slots");
    this.waveVal = $("wave-val");
    this.hostilesVal = $("hostiles-val");
    this.scoreVal = $("score-val");
    this.fpsLabel = $("fps-label");
    this.killfeed = $("killfeed");
    this.announceEl = $("announce");
    this.announceMain = $("announce-main");
    this.announceSub = $("announce-sub");
    this.vignette = $("vignette");
    this.damageRing = $("damage-ring");
    this.hitmarkerEl = $("hitmarker");
    this.reloadLabel = $("reload-label");
    this.crosshair = $("crosshair");
    this.chT = $("ch-t"); this.chB = $("ch-b");
    this.chL = $("ch-l"); this.chR = $("ch-r");

    this.screens = {
      menu: $("screen-menu"),
      pause: $("screen-pause"),
      gameover: $("screen-gameover"),
    };
    this.finalStats = $("final-stats");
    this.pauseHint = $("pause-hint");

    this.vignetteK = 0;
    this.hitT = 0;
    this.announceT = 0;
    this.fpsAcc = 0;
    this.fpsFrames = 0;
  }

  show(on) { this.root.classList.toggle("visible", on); }

  showScreen(name) {
    for (const key of Object.keys(this.screens)) {
      this.screens[key].classList.toggle("visible", key === name);
    }
    // Hide the cursor only while the player is actually in control.
    document.body.classList.toggle("in-combat", name === null || name === undefined);
  }

  // Called when the browser refuses pointer lock, so the on-screen prompts
  // stop telling the player to click to re-capture the mouse.
  setLockFallback(on) {
    if (!on) return;
    this.pauseHint.textContent = "PRESS ESC OR CLICK TO RESUME";
  }

  setHealth(h, max) {
    const k = Math.max(0, h) / max;
    this.healthFill.style.width = `${k * 100}%`;
    this.healthFill.classList.toggle("low", k < 0.35);
    this.healthNum.textContent = String(Math.ceil(h));
    this.lowhp.classList.toggle("pulse", k < 0.3 && h > 0);
  }

  setAmmo(mag, reserve, name) {
    this.ammoMag.textContent = String(mag);
    this.ammoReserve.textContent = `/ ${reserve}`;
    if (name) this.weaponName.textContent = name;
  }

  setSlots(names, active) {
    this.weaponSlots.innerHTML = names
      .map((n, i) => (i === active ? `<b>[${i + 1}] ${n}</b>` : `[${i + 1}] ${n}`))
      .join(" &nbsp; ");
  }

  setWave(n) { this.waveVal.textContent = String(n); }
  setHostiles(n) { this.hostilesVal.textContent = String(n); }
  setScore(n) { this.scoreVal.textContent = String(n); }

  setSpread(px) {
    const d = Math.min(40, px);
    this.chT.style.transform = `translateY(${-d - 4}px)`;
    this.chB.style.transform = `translateY(${d - 5}px)`;
    this.chL.style.transform = `translateX(${-d - 4}px)`;
    this.chR.style.transform = `translateX(${d - 5}px)`;
  }

  setCrosshairVisible(on) {
    this.crosshair.style.opacity = on ? "1" : "0";
  }

  showReload(on) {
    this.reloadLabel.style.display = on ? "block" : "none";
  }

  hitmarker(lethalHead) {
    this.hitmarkerEl.classList.toggle("head", !!lethalHead);
    this.hitmarkerEl.classList.add("show");
    this.hitT = 0.12;
  }

  addKill(text) {
    const div = document.createElement("div");
    div.className = "kf-entry";
    div.innerHTML = text;
    this.killfeed.prepend(div);
    while (this.killfeed.children.length > 5) {
      this.killfeed.removeChild(this.killfeed.lastChild);
    }
    setTimeout(() => div.classList.add("fade"), 3200);
    setTimeout(() => div.remove(), 4200);
  }

  announce(main, sub = "", duration = 2.4) {
    this.announceMain.textContent = main;
    this.announceSub.textContent = sub;
    this.announceEl.classList.add("show");
    this.announceT = duration;
  }

  damageFlash() {
    this.vignetteK = 1;
  }

  damageFrom(angleRad) {
    const arrow = document.createElement("div");
    arrow.className = "dmg-arrow";
    arrow.style.transform = `rotate(${(angleRad * 180) / Math.PI}deg)`;
    this.damageRing.appendChild(arrow);
    setTimeout(() => { arrow.style.opacity = "0"; }, 500);
    setTimeout(() => arrow.remove(), 950);
  }

  setFinalStats(html) {
    this.finalStats.innerHTML = html;
  }

  update(dt) {
    if (this.hitT > 0) {
      this.hitT -= dt;
      if (this.hitT <= 0) this.hitmarkerEl.classList.remove("show");
    }
    if (this.vignetteK > 0) {
      this.vignetteK = Math.max(0, this.vignetteK - dt * 2.2);
      this.vignette.style.opacity = String(this.vignetteK);
    }
    if (this.announceT > 0) {
      this.announceT -= dt;
      if (this.announceT <= 0) this.announceEl.classList.remove("show");
    }
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fpsLabel.textContent = `${Math.round(this.fpsFrames / this.fpsAcc)} FPS`;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  }

  resetCombat() {
    this.killfeed.innerHTML = "";
    this.damageRing.innerHTML = "";
    this.vignette.style.opacity = "0";
    this.vignetteK = 0;
    this.announceEl.classList.remove("show");
    this.announceT = 0;
    this.lowhp.classList.remove("pulse");
  }
}
