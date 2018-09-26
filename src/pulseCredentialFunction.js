const {pulseCredentials, connectionStringCredentials, claimedCredentials} = require('taskcluster-lib-pulse');

module.exports = (pulse) => {
  const {getCredentialsType} = pulse;
  switch (getCredentialsType) {
    case 'PULSE_CRDENTIALS':
      return pulseCredentials(pulse.pulseCredentials);
    case 'CONNECTION_STRING_CREDENTIALS':
      return connectionStringCredentials(pulse.connectionStringCredentials);
    case 'CLAIMED_CREDENTIALS':
      return claimedCredentials(pulse.claimedCredentials);
    default: return;
  }
};