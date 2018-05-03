const _ = require('lodash');
const assert = require('assert');
const MockDate = require('mockdate');
const Notifier = require('../src/notifier');
const load = require('../src/main');

suite('notifier_test.js', function() {
  let notifier;

  setup(async function() {
    const cfg = await load('cfg', {profile: 'test', process: 'test'});
    const publisher = await load('publisher', {profile: 'test', process: 'test'});
    notifier = new Notifier({
      email: 'tests@taskcluster.net',
      aws: cfg.aws,
      queueName: cfg.app.sqsQueueName,
      emailBlacklist: [],
      publisher,
      maxMessageCount: 5,
      maxMessageTime: 10,
    });

    MockDate.set('1/1/2000');
  });

  teardown(function() {
    MockDate.reset();
  });

  const timeFlies = (seconds) => {
    const newTime = new Date();
    newTime.setSeconds(newTime.getSeconds() + seconds);
    MockDate.set(newTime);
  };

  suite('rateLimit', function() {
    test('does not rate-limit a single send', function() {
      assert(notifier.rateLimit('foo@taskcluster.net') >= 0);
    });

    test('does rate-limit sends at higher than 5 per 10 seconds', function() {
      // send at 1 per second..
      const limited = _.range(10).map(() => {
        timeFlies(1);
        return notifier.rateLimit('foo@taskcluster.net');
      });
      assert.deepEqual(limited, [
        4, 3, 2, 1, 0, // five not limited
        -1, -1, -1, -1, -1, // remainder limited
      ]);
    });

    test('lifts the rate limit maxMessageTime after a message is sent', function() {
      // send 3 all at once
      _.range(3).forEach(() => {
        notifier.rateLimit('foo@taskcluster.net');
      });
      // 5 seconds later, another 2
      timeFlies(5);
      _.range(2).forEach(() => {
        notifier.rateLimit('foo@taskcluster.net');
      });
      // 7 seconds later, we should have 2 remaining after sending another
      timeFlies(7);
      assert.equal(notifier.rateLimit('foo@taskcluster.net'), 2);
    });
  });
});
