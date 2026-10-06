// 游戏流程：输入 → 规则核心 → 界面。地图点击寻路（二次确认）、交互弹窗、战斗、存档。

import { predict, UNARMOR_COST, type Prediction } from '../core/combat';
import { showPool, upgrade } from '../core/dice';
import type { MonsterDef } from '../core/data/monsters';
import {
  CAMPFIRE,
  COST,
  Game,
  MERCHANT,
  monsterSpec,
  type AltarOption,
  type ExchangeOption,
  type FaintResult,
  type MerchantItem,
  type Pos,
  type StepOutcome,
} from '../core/tower';
import { lang, setLang, t, td, type Lang, type MessageKey } from '../i18n';
import { deleteSave, exportCode, importCode, readSave, writeSave, type Slot } from '../save';
import { closeBattle, runBattle } from './battleView';
import { h, isModalOpen, openModal, sleep } from './dom';
import { renderHud, setStatus } from './hud';

export interface MapViewLike {
  render(): void;
  showPath(path: Pos[] | null, faintAt: number | null): void;
}

const STEP_DELAY = 70;

export class Controller {
  game: Game;
  view: MapViewLike | null = null;
  private preview: { target: Pos; path: Pos[] } | null = null;
  private busy = false;
  private reduceMotion: boolean;

  constructor(game: Game) {
    this.game = game;
    let rm = false;
    try {
      rm = localStorage.getItem('tomd.reduceMotion') === '1';
    } catch {
      // 忽略
    }
    this.reduceMotion = rm || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    document.body.classList.toggle('reduce-motion', this.reduceMotion);
  }

  attach(view: MapViewLike): void {
    this.view = view;
    this.refresh();
    setStatus(t('path.hint'));
  }

  refresh(): void {
    renderHud(document.getElementById('hud')!, this.game);
    this.view?.render();
    this.renderControls();
  }

  private get locked(): boolean {
    return this.busy || isModalOpen() || this.game.state.status !== 'playing';
  }

  // ---------- 输入 ----------

  tap(target: Pos): void {
    if (this.locked) return;
    const p = this.preview;
    if (p && p.target.x === target.x && p.target.y === target.y) {
      this.clearPreview();
      void this.walk(p.path);
      return;
    }
    const path = this.game.findPath(target);
    if (!path) {
      this.clearPreview();
      setStatus(t('path.none'), true);
      return;
    }
    // 相邻格子直接行动，不需要二次确认
    if (path.length === 1) {
      this.clearPreview();
      void this.walk(path);
      return;
    }
    const cost = this.game.pathCost(path);
    const stamina = this.game.hero.stamina;
    const faintAt = cost >= stamina ? stamina : null;
    this.preview = { target, path };
    this.view?.showPath(path, faintAt);
    if (faintAt !== null) setStatus(t('path.faint', { steps: path.length, cost, at: faintAt }), true);
    else setStatus(t('path.preview', { steps: path.length, cost }));
  }

  move(dx: number, dy: number): void {
    if (this.locked) return;
    this.clearPreview();
    const { x, y } = this.game.state.pos;
    void this.walk([{ x: x + dx, y: y + dy }]);
  }

  private clearPreview(): void {
    this.preview = null;
    this.view?.showPath(null, null);
  }

  private async walk(path: Pos[]): Promise<void> {
    this.busy = true;
    setStatus('');
    try {
      for (let i = 0; i < path.length; i++) {
        const outcomes = this.game.stepTo(path[i]);
        this.refresh();
        let stop = false;
        for (const o of outcomes) {
          const cont = await this.handle(o);
          if (!cont) stop = true;
        }
        if (stop || outcomes[0].kind !== 'moved') break;
        if (i < path.length - 1) await sleep(this.reduceMotion ? 20 : STEP_DELAY);
      }
    } finally {
      this.busy = false;
      this.refresh();
      this.persistResume();
    }
  }

  /** 处理一步的结果；返回 false 表示停止继续走 */
  private async handle(o: StepOutcome): Promise<boolean> {
    switch (o.kind) {
      case 'moved':
        return true;
      case 'blocked':
        return false;
      case 'pickup': {
        const key = `msg.pickup.${o.item}` as MessageKey;
        const pool = o.item === 'a' ? this.game.hero.atk : this.game.hero.def;
        setStatus(t(key, { pool: showPool(pool) }));
        return false;
      }
      case 'door':
        setStatus(o.opened ? t('msg.door.open') : t(`msg.door.locked.${o.color}`), !o.opened);
        return false;
      case 'stairs':
        setStatus(t(o.dir === 'up' ? 'msg.stairs.up' : 'msg.stairs.down', { n: o.floor + 1 }));
        await writeSave('auto', this.game.serialize());
        return false;
      case 'monster':
        await this.confirmBattle(o.monster, o.at);
        return false;
      case 'object':
        await this.openObject(o.obj, o.at);
        return false;
      case 'won':
        this.refresh();
        await deleteSave('resume');
        this.showWon();
        return false;
      case 'faint':
        await this.showFaint(o.result);
        return false;
    }
  }

  // ---------- 战斗 ----------

  private predictions(m: MonsterDef): { plain: Prediction; skill: Prediction | null } {
    const hero = this.game.heroSpec();
    const stamina = Math.max(0, this.game.hero.stamina - COST.battle);
    const plain = predict(hero, monsterSpec(m), stamina, 800, 'never');
    const skill = hero.unarmor && stamina >= UNARMOR_COST ? predict(hero, monsterSpec(m), stamina, 800, 'broken') : null;
    return { plain, skill };
  }

  private predictTable(m: MonsterDef): HTMLElement {
    const { plain, skill } = this.predictions(m);
    const cols = [plain, ...(skill ? [skill] : [])];
    const row = (label: string, f: (p: Prediction) => string) =>
      h('tr', {}, h('th', {}, label), ...cols.map((p) => h('td', {}, f(p))));
    return h(
      'table',
      { class: 'predict' },
      h(
        'tr',
        {},
        h('th', {}, ''),
        h('th', {}, t('battle.predict.plain')),
        ...(skill ? [h('th', {}, t('battle.predict.skill'))] : []),
      ),
      row(t('battle.predict.win'), (p) => `${Math.round(p.winRate * 100)}%`),
      row(t('battle.predict.loss'), (p) => p.avgLoss.toFixed(1)),
      row(t('battle.predict.p90'), (p) => String(p.p90Loss)),
      row(t('battle.predict.ratio'), (p) => `${p.avgHeroActions.toFixed(1)} : ${p.avgEnemyActions.toFixed(1)}`),
    );
  }

  private monsterInfo(m: MonsterDef): HTMLElement {
    const extra: string[] = [];
    if (m.group) extra.push(t('manual.group', { n: m.group }));
    if (m.drainStamina) extra.push(t('manual.drain', { n: m.drainStamina }));
    extra.push(`${t('battle.predict.drop')} ${m.crystals}`);
    return h(
      'div',
      { class: 'monster-card' },
      h('span', { class: 'name' }, td(`monster.${m.id}.name`)),
      h(
        'span',
        { class: 'meta' },
        t('manual.stats', { atk: m.atk, def: m.def, dodge: m.dodge || '—', hp: m.hp, spd: m.spd }),
      ),
      h('span', { class: 'meta' }, extra.join(' · ')),
    );
  }

  private confirmBattle(m: MonsterDef, at: Pos): Promise<void> {
    return new Promise((resolve) => {
      const { plain, skill } = this.predictions(m);
      const best = Math.max(plain.winRate, skill?.winRate ?? 0);
      let fighting = false;
      openModal({
        title: t('battle.confirm.title'),
        body: [
          this.monsterInfo(m),
          this.predictTable(m),
          h('p', { class: 'muted' }, t('battle.confirm.cost', { n: COST.battle })),
          best < 0.5 ? h('p', { class: 'warn' }, t('battle.confirm.lowWin')) : null,
          m.boss ? h('p', { class: 'warn' }, t('battle.confirm.boss')) : null,
        ],
        actions: [
          { label: t('btn.cancel') },
          {
            label: t('btn.fight'),
            primary: true,
            onClick: () => {
              fighting = true;
              void this.fight(m, at).then(() => resolve());
            },
          },
        ],
        // 取消、点背景关闭：直接结束；选择交战：等战斗打完
        onClose: () => setTimeout(() => !fighting && resolve(), 0),
      });
    });
  }

  private async fight(m: MonsterDef, at: Pos): Promise<void> {
    this.busy = true;
    const battle = this.game.startBattle(m);
    this.refresh();
    const outcome = await runBattle(battle, m, this.reduceMotion);
    const res = this.game.finishBattle(battle, at);
    closeBattle();
    this.refresh();
    this.busy = false;
    if (outcome === 'win') setStatus(t('battle.win', { n: res.crystals }));
    if (outcome === 'retreat') setStatus(t('battle.retreated'));
    if (this.game.state.status === 'dead') {
      await deleteSave('resume');
      this.showGameOver();
      return;
    }
    if (res.faint) await this.showFaint(res.faint);
    this.persistResume();
  }

  // ---------- 昏迷 ----------

  private showFaint(r: FaintResult): Promise<void> {
    return new Promise((resolve) => {
      const text =
        r.outcome === 'death'
          ? t('faint.death')
          : t(`faint.${r.outcome}`, { stamina: r.stamina, max: r.maxStamina });
      openModal({
        title: t('faint.title'),
        dismissable: false,
        body: [h('p', {}, t('faint.desc')), h('div', { class: 'center' }, h('span', { class: 'big-die' }, String(r.roll))), h('p', { class: r.outcome === 'death' ? 'warn' : '' }, text)],
        actions: [
          {
            label: t('btn.continue'),
            primary: true,
            onClick: () => {
              this.refresh();
              if (r.outcome === 'death') {
                void deleteSave('resume');
                this.showGameOver();
              }
              resolve();
            },
          },
        ],
      });
    });
  }

  // ---------- 物件 ----------

  private openObject(obj: string, at: Pos): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        this.refresh();
        this.persistResume();
        resolve();
      };
      switch (obj) {
        case 'campfire':
          this.openCampfire(at, done);
          break;
        case 'merchant':
          this.openMerchant(done);
          break;
        case 'altar':
          this.openAltar(done);
          break;
        case 'exchanger':
          this.openExchanger(done);
          break;
        case 'sign':
          openModal({
            title: t('sign.title'),
            body: h('p', {}, td(`sign.${this.game.state.floor}`)),
            actions: [{ label: t('btn.close'), primary: true }],
            onClose: done,
          });
          break;
        case 'event':
          openModal({
            title: t('event.mill.title'),
            dismissable: false,
            body: h('p', {}, t('event.mill.desc')),
            actions: [
              { label: t('event.mill.remember'), primary: true, onClick: () => this.game.resolveEvent(at, 'remember') },
              { label: t('event.mill.forget'), onClick: () => this.game.resolveEvent(at, 'forget') },
            ],
            onClose: done,
          });
          break;
        default:
          done();
      }
    });
  }

  private openCampfire(at: Pos, done: () => void): void {
    const g = this.game;
    const uses = g.campfireUses(at);
    const hpGain = Math.ceil(g.hero.maxHp * CAMPFIRE.hpRatio);
    const close = openModal({
      title: t('campfire.title'),
      body: [
        h('p', {}, uses > 0 ? t('campfire.desc', { n: uses, stamina: CAMPFIRE.stamina, hp: hpGain }) : t('campfire.out')),
        h('p', { class: 'muted' }, t('campfire.line')),
      ],
      actions: [
        { label: t('btn.close') },
        ...(uses <= 0 && g.hero.firewood > 0
          ? [
              {
                label: t('campfire.addWood', { n: g.hero.firewood }),
                keepOpen: true,
                onClick: () => {
                  g.addFirewood(at);
                  close();
                  this.openCampfire(at, done);
                },
              },
            ]
          : []),
        {
          label: t('campfire.rest'),
          primary: true,
          disabled: uses <= 0,
          onClick: () => {
            const r = g.rest(at);
            if (r) setStatus(t('campfire.rested', r));
          },
        },
      ],
      onClose: done,
    });
  }

  private shopList<T extends string>(
    items: T[],
    label: (i: T) => string,
    price: (i: T) => string,
    can: (i: T) => boolean,
    act: (i: T) => void,
    rerender: () => void,
  ): HTMLElement {
    return h(
      'div',
      { class: 'list' },
      ...items.map((i) =>
        h(
          'button',
          {
            disabled: !can(i),
            onclick: () => {
              act(i);
              this.refresh();
              rerender();
            },
          },
          h('span', {}, label(i)),
          h('span', { class: 'muted' }, price(i)),
        ),
      ),
    );
  }

  private openMerchant(done: () => void, reopen = false): void {
    const g = this.game;
    const items: MerchantItem[] = ['yellowKey', 'blueKey', 'potion', 'firewood'];
    let close = () => {};
    const rerender = () => {
      close();
      this.openMerchant(done, true);
    };
    close = openModal({
      title: t('merchant.title'),
      body: [
        h('p', { class: 'muted' }, reopen ? t('merchant.line') : t('merchant.desc')),
        h('p', {}, `💎 ${g.hero.crystals}`),
        this.shopList(
          items,
          (i) => t(`merchant.${i}`),
          (i) => t('merchant.price', { n: MERCHANT[i] }),
          (i) => g.hero.crystals >= MERCHANT[i] && !(i === 'potion' && g.hero.hp >= g.hero.maxHp),
          (i) => g.buy(i),
          () => rerender(),
        ),
      ],
      actions: [{ label: t('btn.close'), primary: true, onClick: done }],
    });
  }

  private openAltar(done: () => void): void {
    const g = this.game;
    const price = g.altarPrice();
    const opts: AltarOption[] = ['atk', 'def', 'hp', 'stamina'];
    const label = (o: AltarOption) => {
      if (o === 'atk') return t('altar.atk', { from: showPool(g.hero.atk), to: showPool(upgrade(g.hero.atk)) });
      if (o === 'def') return t('altar.def', { from: showPool(g.hero.def), to: showPool(upgrade(g.hero.def)) });
      return t(`altar.${o}`);
    };
    let close = () => {};
    close = openModal({
      title: t('altar.title'),
      body: [
        h('p', {}, t('altar.desc', { n: price })),
        h('p', {}, `💎 ${g.hero.crystals}`),
        this.shopList(
          opts,
          label,
          () => t('merchant.price', { n: price }),
          () => g.hero.crystals >= price,
          (o) => g.altar(o),
          () => {
            close();
            this.openAltar(done);
          },
        ),
      ],
      actions: [{ label: t('btn.close'), primary: true, onClick: done }],
    });
  }

  private openExchanger(done: () => void): void {
    const g = this.game;
    const opts: ExchangeOption[] = ['spring', 'keysmith', 'sellYellow', 'sellBlue', 'bloodPact'];
    let close = () => {};
    close = openModal({
      title: t('exchanger.title'),
      body: [
        h('p', { class: 'muted' }, t('exchanger.desc')),
        h('p', {}, `💎 ${g.hero.crystals}`),
        this.shopList(
          opts,
          (o) => t(`exchanger.${o}`),
          () => '',
          (o) => g.canExchange(o),
          (o) => g.exchange(o),
          () => {
            close();
            this.openExchanger(done);
          },
        ),
      ],
      actions: [{ label: t('btn.close'), primary: true, onClick: done }],
    });
  }

  // ---------- 手册 / 角色 / 菜单 ----------

  showManual(): void {
    if (this.locked) return;
    const ms = this.game.floorMonsters();
    openModal({
      title: t('manual.title', { n: this.game.state.floor + 1 }),
      dismissable: true,
      body: ms.length
        ? ms.map((m) => h('div', {}, this.monsterInfo(m), this.predictTable(m)))
        : h('p', { class: 'muted' }, t('manual.empty')),
      actions: [{ label: t('btn.close'), primary: true }],
    });
  }

  showHero(): void {
    if (this.locked) return;
    const s = this.game.hero;
    openModal({
      title: t('hero.title'),
      dismissable: true,
      body: [
        h('p', {}, t('hero.stats', { atk: showPool(s.atk), def: showPool(s.def), dodge: showPool(s.dodge), spd: s.spd })),
        h('p', {}, t('hero.hp', { hp: s.hp, max: s.maxHp, stamina: s.stamina, smax: s.maxStamina })),
        h('p', {}, t('hero.passive')),
        h('p', {}, t('hero.active')),
        h(
          'p',
          { class: 'muted' },
          s.traits.length ? t('hero.traits', { list: s.traits.map((x) => td(`trait.${x}`)).join('、') }) : t('hero.noTraits'),
        ),
      ],
      actions: [{ label: t('btn.close'), primary: true }],
    });
  }

  showMenu(): void {
    if (this.busy || isModalOpen()) return;
    const playing = this.game.state.status === 'playing';
    openModal({
      title: t('menu.title'),
      dismissable: true,
      body: [
        h(
          'div',
          { class: 'list' },
          h(
            'button',
            {
              onclick: () => {
                const next: Lang = lang() === 'zh-CN' ? 'en' : 'zh-CN';
                setLang(next);
                location.reload();
              },
            },
            h('span', {}, t('menu.language')),
            h('span', { class: 'muted' }, lang() === 'zh-CN' ? '简体中文 → English' : 'English → 简体中文'),
          ),
        ),
        h(
          'label',
          { class: 'toggle' },
          h('input', {
            type: 'checkbox',
            checked: this.reduceMotion,
            onchange: (e: Event) => {
              this.reduceMotion = (e.target as HTMLInputElement).checked;
              document.body.classList.toggle('reduce-motion', this.reduceMotion);
              try {
                localStorage.setItem('tomd.reduceMotion', this.reduceMotion ? '1' : '0');
              } catch {
                // 忽略
              }
            },
          }),
          t('menu.reduceMotion'),
        ),
        h('p', { class: 'muted' }, t('menu.privacy')),
      ],
      actions: [
        ...(playing
          ? [
              {
                label: t('menu.save'),
                primary: true,
                onClick: () => {
                  void writeSave('quick', this.game.serialize()).then(() => setStatus(t('msg.saved')));
                },
              },
            ]
          : []),
        { label: t('menu.loadQuick'), onClick: () => void this.load('quick') },
        { label: t('menu.loadAuto'), onClick: () => void this.load('auto') },
        { label: t('menu.export'), onClick: () => this.exportSave() },
        { label: t('menu.import'), onClick: () => this.importSave() },
        {
          label: t('menu.newGame'),
          danger: true,
          onClick: () => {
            if (confirm(t('menu.newGameConfirm'))) this.replace(Game.create());
          },
        },
      ],
    });
  }

  private async load(slot: Slot): Promise<void> {
    const s = await readSave(slot);
    if (!s) {
      setStatus(t('menu.noSave'), true);
      return;
    }
    this.replace(new Game(s));
    setStatus(t('msg.loaded'));
  }

  replace(game: Game): void {
    this.game = game;
    this.clearPreview();
    this.refresh();
    this.persistResume();
  }

  private exportSave(): void {
    const code = exportCode(this.game.serialize());
    const area = h('textarea', { readOnly: true }, code);
    openModal({
      title: t('menu.export'),
      dismissable: true,
      body: [h('p', { class: 'muted' }, t('menu.exportManual')), area],
      actions: [
        {
          label: t('btn.confirm'),
          primary: true,
          onClick: () => {
            void navigator.clipboard?.writeText(code).then(
              () => setStatus(t('menu.exportDone')),
              () => undefined,
            );
          },
        },
      ],
    });
    area.select();
  }

  private importSave(): void {
    const area = h('textarea', { placeholder: 'TOMD1:…' });
    openModal({
      title: t('menu.import'),
      dismissable: true,
      body: [h('p', { class: 'muted' }, t('menu.importPrompt')), area],
      actions: [
        { label: t('btn.cancel') },
        {
          label: t('btn.confirm'),
          primary: true,
          onClick: () => {
            const s = importCode(area.value);
            if (!s) setStatus(t('menu.importFail'), true);
            else {
              this.replace(new Game(s));
              setStatus(t('msg.loaded'));
            }
          },
        },
      ],
    });
  }

  private showGameOver(): void {
    openModal({
      title: t('over.title'),
      dismissable: false,
      body: h('p', {}, t('over.desc')),
      actions: [
        { label: t('menu.loadQuick'), onClick: () => void this.load('quick').then(() => this.reopenIfDead()) },
        { label: t('menu.loadAuto'), onClick: () => void this.load('auto').then(() => this.reopenIfDead()) },
        { label: t('menu.newGame'), primary: true, onClick: () => this.replace(Game.create()) },
      ],
    });
  }

  private reopenIfDead(): void {
    if (this.game.state.status === 'dead') this.showGameOver();
  }

  private showWon(): void {
    const st = this.game.state.stats;
    openModal({
      title: t('won.title'),
      dismissable: false,
      body: [h('p', {}, t('won.desc')), h('p', { class: 'muted' }, t('won.stats', st))],
      actions: [{ label: t('menu.newGame'), primary: true, onClick: () => this.replace(Game.create()) }],
    });
  }

  // ---------- 存档 ----------

  private resumeTimer = 0;

  /** 「继续游戏」存档：每次行动后写一次（防抖），切到后台时立刻写 */
  persistResume(immediate = false): void {
    if (this.game.state.status !== 'playing' || this.busy) return;
    clearTimeout(this.resumeTimer);
    // 写入时再检查一次：战斗中（体力已扣、随机数已推进、怪物还活着）的状态不能存
    const write = () => {
      if (this.game.state.status === 'playing' && !this.busy) void writeSave('resume', this.game.serialize());
    };
    if (immediate) write();
    else this.resumeTimer = window.setTimeout(write, 400);
  }

  // ---------- 操作区 ----------

  private renderControls(): void {
    const el = document.getElementById('controls')!;
    const btn = (label: string, onclick: () => void) => h('button', { onclick }, label);
    const arrow = (cls: string, label: string, dx: number, dy: number) =>
      h('button', { class: cls, 'aria-label': cls, onclick: () => this.move(dx, dy) }, label);
    el.replaceChildren(
      h(
        'div',
        { class: 'menu-buttons' },
        btn(t('btn.manual'), () => this.showManual()),
        btn(t('btn.hero'), () => this.showHero()),
        btn(t('btn.menu'), () => this.showMenu()),
      ),
      h(
        'div',
        { class: 'dpad' },
        arrow('up', '▲', 0, -1),
        arrow('left', '◀', -1, 0),
        arrow('down', '▼', 0, 1),
        arrow('right', '▶', 1, 0),
      ),
    );
  }
}
