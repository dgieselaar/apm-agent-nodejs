'use strict'

const os = require('os')

const test = require('tape')

const Profiles = require('../../lib/profiles')

let agent

function mockAgent (conf = {}, onProfile) {
  return {
    _conf: conf,
    sendProfile (profile) {
      onProfile(profile)
    }
  }
}

test('collects profiles', function ( t ) {

  const agent = mockAgent({

  }, ( profileBuffer ) => {
    t.ok(!!profileBuffer, 'agent.sendProfile was called')

    t.end()
  })

  const profiles = new Profiles(agent)

  profiles.startCpuProfile('foo')
    .then(( stop ) => {

      setTimeout(( ) => {
        stop()
      }, 2500)

    })

})
