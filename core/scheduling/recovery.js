"use strict";

function decide(sla) {
  const productionReady = !!(sla && sla.productionReady);
  const safeToRecover = !!(sla && sla.safeToRecover);
  return {
    todayVideoScheduled: !!(sla && sla.scheduled),
    youtubeTodayExists: !!(sla && sla.youtubeTodayExists),
    verificationSucceeded: !!(sla && sla.youtubeVerified),
    startProduction: !productionReady && safeToRecover,
    repairNotification: productionReady && !sla.notificationExists,
    notifyHuman: !productionReady && !safeToRecover,
  };
}

function afterRecovery(sla, recoveryResult) {
  const healthy = !!(sla && sla.healthy);
  return {
    automaticRecoveryStarted: !!(recoveryResult && recoveryResult.started),
    recoverySucceeded: healthy,
    notifyHuman: !!(recoveryResult && recoveryResult.started && !healthy),
  };
}

module.exports = { decide, afterRecovery };
