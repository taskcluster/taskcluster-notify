let debug = require('debug')('notify');
let _ = require('lodash');
let assert = require('assert');
let taskcluster = require('taskcluster-client');

/** Handler listening for tasks that carries notifications */
class Handler {
  /** Construct listener given notifier, pulse credentials and queueName */
  constructor({notifier, validator, credentials, queueName, monitor, routePrefix}) {
    this.queue = new taskcluster.Queue();

    this.notifier = notifier;
    this.validator = validator;
    this.monitor = monitor;
    this.routePrefix = routePrefix;

    // Create listener
    this.listener = new taskcluster.PulseListener({credentials, queueName});

    // Bind to exchanges with pattern for custom routing keys
    let qe = new taskcluster.QueueEvents();
    this.listener.bind(qe.taskCompleted(`route.${routePrefix}.#.on-completed.#`));
    this.listener.bind(qe.taskCompleted(`route.${routePrefix}.#.on-any.#`));
    this.listener.bind(qe.taskFailed(`route.${routePrefix}.#.on-failed.#`));
    this.listener.bind(qe.taskFailed(`route.${routePrefix}.#.on-any.#`));
    this.listener.bind(qe.taskException(`route.${routePrefix}.#.on-exception.#`));
    this.listener.bind(qe.taskException(`route.${routePrefix}.#.on-any.#`));

    // Handle messages
    this.listener.on('message', this.monitor.timedHandler('notification', this.onMessage.bind(this)));
  }

  async listen() {
    await this.listener.connect();
    await this.listener.resume();
  }

  async onMessage(message) {
    // Load task definition
    let taskId = message.payload.status.taskId;
    let task = await this.queue.task(taskId);
    let status = await this.queue.status(taskId);
    let href = `https://tools.taskcluster.net/task-inspector/#${taskId}`;
    let groupHref = `https://tools.taskcluster.net/task-group-inspector/#/${task.taskGroupId}`;
    let runCount = status.status.runs.length;

    debug(`Received message for ${taskId} with notify routes. Finding notifications.`);
    this.monitor.count('notification-requested.any');

    return Promise.all(message.routes.map(entry => {
      let route = entry.split('.');

      // convert from on- syntax to state. e.g. on-exception -> exception
      let decider = _.join(_.slice(route[route.length -1], 3), '');
      if (decider !== 'any' && status.status.state !== decider) {
        return;
      }

      let ircmessage = `Task "${task.metadata.name}" complete with status '${status.status.state}'. Inspect: ${href}`;

      switch (route[1]) {
        case 'irc-user':
          this.monitor.count('notification-requested.irc-user');
          if (_.has(task, 'extra.notify.irc-user.message')) {
            message = jsone(_.get(task, 'extra.notify.irc-user.message'), status);
          }
          return this.notifier.irc({
            user: route[2],
            message: ircmessage,
          });

        case 'irc-channel':
          this.monitor.count('notification-requested.irc-channel');
          if (_.has(task, 'extra.notify.irc-channel.message')) {
            message = jsone(_.get(task, 'extra.notify.irc-user.message'), status);
          }
          return this.notifier.irc({
            channel: route[2],
            message: ircmessage,
          });

        case 'pulse':
          this.monitor.count('notification-requested.pulse');
          return this.notifier.pulse({
            routingKey: _.join(_.slice(route, 2, route.length - 1), '.'),
            message: status,
          });

        case 'email':
          this.monitor.count('notification-requested.email');
          let content = `
Task [\`${taskId}\`](${href}) in task-group [\`${task.taskGroupId}\`](${groupHref}) is complete.

**Status:** ${status.status.state} (in ${runCount} run${runCount === 1? '' : 's'})
**Name:** ${task.metadata.name}
**Description:** ${task.metadata.description}
**Owner:** ${task.metadata.owner}
**Source:** ${task.metadata.source}
          `;
          let link = {text: 'Inspect Task', href};
          let subject = `Task ${status.status.state}: ${task.metadata.name} - ${taskId}`;
          let template = 'simple';
          if (_.has(task, 'extra.notify.email')) {
            let extra = task.extra.notify.email;
            content = email.content ? jsone(email.content, status) : content;
            subject = email.subject ? jsone(email.subject, status) : subject;
            link = email.link ? jsone(email.link, status) : link;
            template = email.template ? jsone(email.template, status) : template;
          }
          return this.notifier.email({
            address:  _.join(_.slice(route, 2, route.length - 1), '.'),
            content,
            subject,
            link,
            template,
          });

        default:
      }
    }));
  }
};

// Export Handler
module.exports = Handler;

