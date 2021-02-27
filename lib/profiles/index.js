const agentSymbol = Symbol('profiles-agent')
const pprof = require('pprof')

const CPU_INTERVAL_MICROS = 1000
const CPU_DURATION_MILLIS = 10000
const HEAP_INTERVAL_BYTES = 512 * 1024
const HEAP_STACK_DEPTH = 64

function normalizeHeapProfile ( profile ) {

  profile.sampleType.forEach(sampleType => {
    const typeStringIndex = parseInt(sampleType.type, 10)
    const type = profile.stringTable[typeStringIndex]

    let replacement

    switch(type) {
      case 'objects':
        replacement = 'alloc_objects'
      break

      case 'space':
        replacement = 'alloc_space'
      break
    }

    if (replacement !== undefined) {
      profile.stringTable[typeStringIndex] = replacement
    }
  })

  return profile
}

class Profiles {

  clearCpuTimeout = null
  clearHeapInterval = null

  runningProfile = Promise.resolve()

  constructor(agent) {
    this[agentSymbol] = agent
  }

  async startProfile ( cb, metadata ) {
    
    const profile = await this.queue(cb)

    const buffer = await pprof.encode(profile)

    console.log('sending profile', buffer.length, buffer.byteLength)

    return new Promise(( resolve, reject ) => {
      this[agentSymbol].sendProfile(buffer, metadata, ( err  ) => err ? reject(err) : resolve(profile))
    })
  }

  async queue(cb) {
    await this.runningProfile
    
    const res = Promise.resolve().then(( ) => cb())

    this.runningProfile = res.then(( ) => {}, ( ) => {})

    return res
  }

  collectCpuProfile() {
    return this.startProfile(() => {
      this[agentSymbol].logger.info('Collecting CPU profile')
      return pprof.time.profile({
        durationMillis: CPU_DURATION_MILLIS,
        intervalMicros: CPU_INTERVAL_MICROS
      })
    }).catch( err => {
      this[agentSymbol].logger.error('Failed to collect CPU profile', err)
    })
  }

  collectHeapProfile() {
    return this.startProfile(() => {
      this[agentSymbol].logger.info('Collecting heap profile')
      return normalizeHeapProfile(pprof.heap.profile())
    }).catch( err => {
      this[agentSymbol].logger.error('Failed to collect heap profile', err)
    })
  }

  async startCpuProfile(name, metadata ) {

    return this.queue(( ) => {
      const stopProfile = pprof.time.start(CPU_INTERVAL_MICROS, name)
      let stop = ( ) => {}
      this.startProfile(new Promise(( resolve, reject ) => {
        stop = ( ) => {
          try {
            resolve(stopProfile())
          } catch ( err ) {
            reject(err)
          }
        }
      }), metadata)
      return ( ) => stop()
    })
    
  }

  async getHeapProfile () {
    return this.startProfile(( ) => {
      return normalizeHeapProfile(pprof.heap.profile())
    })
  }

  onCpuTimeout() {
    if (this[agentSymbol]._conf.profileCpu) {
      this[agentSymbol].clearCpuTimeout = setTimeout(
        () => {
          this.collectCpuProfile().then(( ) => {
            this.onCpuTimeout()
          })
        },
        this[agentSymbol]._conf.profileCpuInterval
      )
    }
  }

  onHeapTimeout() {
    if (this[agentSymbol]._conf.profileHeap) {
      this[agentSymbol].clearHeapTimeout = setTimeout(
        () => {
          this.collectHeapProfile().then(( ) => {
            this.onHeapTimeout()
          })
        },
        this[agentSymbol]._conf.profileHeapInterval
      )
    }
  }

  start() {

    this.onCpuTimeout()

    if(this[agentSymbol]._conf.profileHeap) {
      pprof.heap.start(HEAP_INTERVAL_BYTES, HEAP_STACK_DEPTH)
    }
    
    this.onHeapTimeout()

  }

  stop() {
    if (this._clearCpuTimeout) {
      this._clearCpuTimeout()
    }
    if (this._clearHeapInterval) {
      this._clearHeapInterval()
    }

    return this.waitUntilCompleted()
  }
}

module.exports = Profiles
