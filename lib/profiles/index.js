const agentSymbol = Symbol('profiles-agent')
const pprof = require('pprof');
const util = require('util')

const INTERVAL_MICROS = 1000;
const DURATION_MILLIS = 10000;

class Profiles {

  _clearCpuTimeout = null;
  _clearHeapInterval = null;

  _runningProfiles = [];

  constructor(agent) {
    this[agentSymbol] = agent
  }

  _trackProfile(promise) {
    this._runningProfiles.push(promise);

    promise.finally(() => {
      this._runningProfiles.splice(this._runningProfiles.indexOf(promise), 1);
    });

    return promise
  }

  _untilCompleted() {
    return this._runningProfiles.length ? Promise.all(this._runningProfiles) : Promise.resolve();
  }

  _sendProfile(profile) {
    return pprof.encode(profile)
      .then(buffer => {
        this[agentSymbol].sendProfile(buffer);
        return buffer
      })
  }

  _collectCpuProfile() {
    const promise =
      this._untilCompleted()
        .then(() => {
          return pprof.time.profile({
            durationMillis: DURATION_MILLIS,
            intervalMicros: INTERVAL_MICROS
          }).then(profile => this._sendProfile(profile));
        });

    this._trackProfile(promise);
  }

  startCpuProfile(name) {
    return this._trackProfile(
      this._untilCompleted()
        .then(() => {
          const stop = pprof.time.start(INTERVAL_MICROS, name);

          return () => {
            const profile = stop();
            return this._sendProfile(profile);
          };
        })
    );
  }

  _onCpuTimeout() {
    if (this[agentSymbol]._conf.profileCpu) {
      this[agentSymbol]._clearCpuTimeout = setTimeout(
        () => {
          this._collectCpuProfile();
          this._onCpuTimeout()
        },
        this[agentSymbol]._conf.profileCpuInterval
      );
    }
  }

  start() {

    this._onCpuTimeout();

  }

  stop() {
    if (this._clearCpuTimeout) {
      this._clearCpuTimeout();
    }
    if (this._clearHeapInterval) {
      this._clearHeapInterval();
    }

    return this._untilCompleted();
  }
}

module.exports = Profiles
