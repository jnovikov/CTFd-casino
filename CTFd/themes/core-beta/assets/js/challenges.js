import Alpine from "alpinejs";
import dayjs from "dayjs";
import {Wheel} from 'spin-wheel/dist/spin-wheel-esm';
import {AlignText} from 'spin-wheel/src/constants.js';

import CTFd from "./index";

import { Modal, Tab } from "bootstrap";
import highlight from "./theme/highlight";

function addTargetBlank(html) {
  let dom = new DOMParser();
  let view = dom.parseFromString(html, "text/html");
  let links = view.querySelectorAll('a[href*="://"]');
  links.forEach(link => {
    link.setAttribute("target", "_blank");
  });
  return view.documentElement.outerHTML;
}

window.Alpine = Alpine;

Alpine.store("challenge", {
  data: {
    view: "",
  },
});

Alpine.data("Hint", () => ({
  id: null,
  html: null,

  async showHint(event) {
    if (event.target.open) {
      let response = await CTFd.pages.challenge.loadHint(this.id);
      let hint = response.data;
      if (hint.content) {
        this.html = addTargetBlank(hint.html);
      } else {
        let answer = await CTFd.pages.challenge.displayUnlock(this.id);
        if (answer) {
          let unlock = await CTFd.pages.challenge.loadUnlock(this.id);

          if (unlock.success) {
            let response = await CTFd.pages.challenge.loadHint(this.id);
            let hint = response.data;
            this.html = addTargetBlank(hint.html);
          } else {
            event.target.open = false;
            CTFd._functions.challenge.displayUnlockError(unlock);
          }
        } else {
          event.target.open = false;
        }
      }
    }
  },
}));

Alpine.data("Challenge", () => ({
  id: null,
  next_id: null,
  name: "",
  submission: "",
  tab: null,
  solves: [],
  response: null,
  spinWheel: null,

  async init() {
    highlight();
  },

  getStyles() {
    let styles = {
      "modal-dialog": true,
    };
    try {
      let size = CTFd.config.themeSettings.challenge_window_size;
      switch (size) {
        case "sm":
          styles["modal-sm"] = true;
          break;
        case "lg":
          styles["modal-lg"] = true;
          break;
        case "xl":
          styles["modal-xl"] = true;
          break;
        default:
          break;
      }
    } catch (error) {
      // Ignore errors with challenge window size
      console.log("Error processing challenge_window_size");
      console.log(error);
    }
    return styles;
  },

  async init() {
    highlight();
    this.name = Alpine.store("challenge").data.name;
  },

  async showChallenge() {
    new Tab(this.$el).show();
  },

  async showSolves() {
    this.solves = await CTFd.pages.challenge.loadSolves(this.id);
    this.solves.forEach(solve => {
      solve.date = dayjs(solve.date).format("MMMM Do, h:mm:ss A");
      return solve;
    });
    new Tab(this.$el).show();
  },

  getNextId() {
    let data = Alpine.store("challenge").data;
    return data.next_id;
  },

  async nextChallenge() {
    let modal = Modal.getOrCreateInstance("[x-ref='challengeWindow']");

    // TODO: Get rid of this private attribute access
    // See https://github.com/twbs/bootstrap/issues/31266
    modal._element.addEventListener(
      "hidden.bs.modal",
      event => {
        // Dispatch load-challenge event to call loadChallenge in the ChallengeBoard
        Alpine.nextTick(() => {
          this.$dispatch("load-challenge", this.getNextId());
        });
      },
      { once: true }
    );
    modal.hide();
  },

  skipInputIsValid() {
    return this.name === this.submission;
  },

  async skipChallenge() {
    let url = `/api/v1/challenges/skip`;

    const response = await CTFd.fetch(url, {
        method: "POST",
        body: JSON.stringify({
            challenge_id: this.id,
            submission: this.submission,
        }),
    });
    const result = await response.json();

    this.$dispatch("load-challenges");
  },

  async submitChallenge() {
    this.response = await CTFd.pages.challenge.submitChallenge(
      this.id,
      this.submission
    );

    await this.renderSubmissionResponse();
  },

  async renderSubmissionResponse() {
    if (this.response.data.status === "correct") {
      this.submission = "";
    }

    // Dispatch load-challenges event to call loadChallenges in the ChallengeBoard
    this.$dispatch("load-challenges");
  },
}));

Alpine.data("ChallengeBoard", () => ({
  loaded: false,
  challenges: [],
  challenge: null,
  openChallenges: [],
  canRoll: false,
  isRolling: false,

  async init() {
    await this.loadChallenges();

    if (window.location.hash) {
      let chalHash = decodeURIComponent(window.location.hash.substring(1));
      let idx = chalHash.lastIndexOf("-");
      if (idx >= 0) {
        let pieces = [chalHash.slice(0, idx), chalHash.slice(idx + 1)];
        let id = pieces[1];
        await this.loadChallenge(id);
      }
    }
  },

  getCategories() {
    const categories = [];

    this.challenges.forEach(challenge => {
      const { category } = challenge;

      if (!categories.includes(category)) {
        categories.push(category);
      }
    });

    try {
      const f = CTFd.config.themeSettings.challenge_category_order;
      if (f) {
        const getSort = new Function(`return (${f})`);
        categories.sort(getSort());
      }
    } catch (error) {
      // Ignore errors with theme category sorting
      console.log("Error running challenge_category_order function");
      console.log(error);
    }

    return categories;
  },

  getChallenges(category) {
    let challenges = this.challenges;

    if (category !== null) {
      challenges = this.challenges.filter(challenge => challenge.category === category);
    }

    try {
      const f = CTFd.config.themeSettings.challenge_order;
      if (f) {
        const getSort = new Function(`return (${f})`);
        challenges.sort(getSort());
      }
    } catch (error) {
      // Ignore errors with theme challenge sorting
      console.log("Error running challenge_order function");
      console.log(error);
    }

    return challenges;
  },

  getChallengeClass(c) {
    if (c.locked) {
      return "challenge-locked";
    }
    if (c.skipped) {
      return "challenge-skipped";
    }
    return c.solved_by_me ? 'challenge-solved' : '';
  },

  async roll() {
    this.isRolling = true;

    let url = `/api/v1/challenges/roll`;
    const response = await CTFd.fetch(url, {
        method: "POST",
    });
    if (response.ok) {
      let data = await response.json();
      let challenge_id = data.data.challenge_id;
      let to_roll = data.data.to_roll;
      let indexInOpen = to_roll.findIndex(challenge => challenge.id === challenge_id);
      this.createSpinWheel(to_roll);
      await new Promise(r => setTimeout(r, 1000));
      let spinTime = 10 * 1000;
      this.spinWheel.spinToItem(indexInOpen, spinTime, true, 3);
      await new Promise(r => setTimeout(r, spinTime));
      this.$dispatch("load-challenges");
      this.isRolling = false;
    } else {
      console.log(response);
    }
  },

  createSpinWheel(challenges) {
    if (!this.spinWheel) {
      const container = document.querySelector('.wheel-wrapper');
      this.spinWheel = new Wheel(container, null);
    }

    const availableColors = ['#00B07B', '#4B1AC0', '#220074', '#24EE81', '#5E5BFF', '#8482FF', '#9757FF', '#6D17F9', '#BE96FF', '#5722AC'];
    let categories = Array.from(new Set(challenges.map((challenge) => challenge.category)));
    let items =  challenges.map((challenge) => {
        return {label: `${challenge.name} (${challenge.category})`};
      });
    let colors = [];
    challenges.forEach((c) => {
      let colorIndex = categories.indexOf(c.category) % availableColors.length;
      let color = availableColors[colorIndex];
      colors.push(color);
    });

    let props = {
      radius: 0.84,
      isInteractive: false,
      lineWidth: 1,
      itemLabelRadius: 0.93,
      itemLabelRadiusMax: 0.35,
      itemLabelRotation: 180,
      itemLabelAlign: AlignText.left,
      itemLabelColors: ['#fff'],
      itemLabelBaselineOffset: -0.07,
      overlayImage: 'themes/core-beta/static/img/spin-overlay.svg',
      items: items,
      itemBackgroundColors: colors,
    };

    this.spinWheel.init(props);
  },

  async loadChallenges() {
    this.challenges = await CTFd.pages.challenges.getChallenges();
    this.loaded = true;
    this.openChallenges = this.challenges.filter(challenge =>
        !challenge.solved_by_me && !challenge.skipped && challenge.type !== "hidden"
    );
    this.canRoll = this.openChallenges.length > 0 && this.challenges.filter(challenge => challenge.locked).length === 0;
  },

  async loadChallenge(challengeId) {
    await CTFd.pages.challenge.displayChallenge(challengeId, challenge => {
      challenge.data.view = addTargetBlank(challenge.data.view);
      Alpine.store("challenge").data = challenge.data;

      // nextTick is required here because we're working in a callback
      Alpine.nextTick(() => {
        let modal = Modal.getOrCreateInstance("[x-ref='challengeWindow']");
        // TODO: Get rid of this private attribute access
        // See https://github.com/twbs/bootstrap/issues/31266
        modal._element.addEventListener(
          "hidden.bs.modal",
          event => {
            // Remove location hash
            history.replaceState(null, null, " ");
          },
          { once: true }
        );
        modal.show();
        history.replaceState(null, null, `#${challenge.data.name}-${challengeId}`);
      });
    });
  },
}));

Alpine.start();
