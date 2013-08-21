/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

define(["util","session"], function(util, session) {
  // Leader election code.  See http://en.wikipedia.org/wiki/Bully_algorithm
  // Three messages: "bully-elect", "bully-answer", "bully-announce"

  // This is the permissible latency for the leader-election (bully) protocol
  var BULLY_TIME = 1000;

  var assert = util.assert;

  var bully = util.Module("bully");
  bully.currentLeader = null;
  bully.leaderInDoubt = true;

  var lazyTimer = null;

  function resetLeader() {
    bully.currentLeader = session.clientId;
    bully.leaderInDoubt = true;
  }

  bully.setLeader = function(who) {
    var me = session.clientId;
    bully.currentLeader = who;
    bully.leaderInDoubt = false;
    if (who < me) {
      bully.holdElection();
    } else {
      session.emit("leader");
    }
    if (lazyTimer) {
      clearTimeout(lazyTimer);
    }
  };

  function endElection() {
    var me = session.clientId;
    electionTimer = null;
    // if I didn't hear anyone answer, then I'm the leader!
    if (bully.currentLeader === me) {
      var msg = {
        type: "bully-announce",
        clientId: me
      };
      session.send(msg);
      bully.setLeader(me);
    } else if (bully.leaderInDoubt) {
      // hm, they should have said something by now.
      bully.holdElection();
    }
  }

  var electionTimer = null;
  function resetElectionTimer(longWait) {
    if (electionTimer) {
      clearTimeout(electionTimer);
    }
    electionTimer = setTimeout(endElection, (longWait?2:1)*BULLY_TIME);
  }

  bully.holdElection = function() {
    resetLeader();
    msg = {
      type: "bully-elect",
      clientId: session.clientId
    };
    session.send(msg);
    resetElectionTimer();
  };

  bully.holdElectionLazy = function() {
    // wait up to BULLY_TIME for a leader to contact us, otherwise we'll
    // hold an election.
    if (lazyTimer) {
      clearTimeout(lazyTimer);
    }
    lazyTimer = setTimeout(bully.holdElection, BULLY_TIME);
  };

  session.hub.on("bully-elect", function(msg) {
    var me = session.clientId;
    resetLeader();
    if (msg.clientId < me) {
      resp = {
        type: "bully-answer",
        clientId: me
      };
      session.send(resp);
    } else {
      assert(msg.clientId !== me);
      bully.currentLeader = msg.clientId;
    }
    resetElectionTimer();
  });

  session.hub.on("bully-answer", function(msg) {
    assert(bully.leaderInDoubt);
    if (bully.currentLeader < msg.clientId) {
      bully.currentLeader = msg.clientId;
      resetElectionTimer(true);
    }
  });

  session.hub.on("bully-announce", function(msg) {
    // will hold a new election if I'm a better leader.
    bully.setLeader(msg.clientId);
  });

  bully.amLeader = function() {
    var me = session.clientId;
    return bully.currentLeader === me;
  };

  return bully;
});
