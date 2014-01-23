var timestamp = require('monotonic-timestamp'),
    peek = require('level-peek'),
    setImmediate = global.setImmediate || process.nextTick;

module.exports = function (db, orderFn, releaseFn) {
  if (typeof db.queue === 'undefined') {
    db.queue = {
      push: push.bind(null, db),
      read: read.bind(null, db),
      orderFn: orderFn || timestamp,
      releaseFn: releaseFn || Boolean.bind(null, true),
      _readers: [],
      _reading: false
    };
  }

  return db;
}

function push(db, data, cb) {
  db.put(db.queue.orderFn(data), data, function () {
    cb && cb.apply(null, arguments);
    kick(db);
  });
}

function read(db, cb) {
  cb = cb || noop;
  db.queue._readers.push(cb);
  kick(db);
}

function dequeue(db, cb) {
  cb = cb || noop;
  peek.first(db, { start: null, end: undefined }, function (err, key, value) {
    if (err && err.message === 'range not found') {
      // add back to queue and wait, but unblock read lock
      db.queue._reading = false;
      return db.queue._readers.push(cb);
    }
    if (err) return cb(err);
    if (!db.queue.releaseFn(value)) {
      // add back to queue and wait, but unblock read lock
      db.queue._reading = false;
      db.queue._readers.push(cb)
      setTimeout(function () {
        kick(db);
      }, 100);
      return ;
    }
    db.del(key, function (err) {
      if (err) return cb(err);
      cb(err, value, key);
    });
  });
}

function kick(db) {
  if (db.queue._reading || db.queue._readers.length === 0) return;
  db.queue._reading = true;
  setImmediate(function () {
    var cb = db.queue._readers.shift();
    dequeue(db, function () {
      db.queue._reading = false;
      cb.apply(null, arguments);
      kick(db);
    });
  })
}

function noop() {
}
