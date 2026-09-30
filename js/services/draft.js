/* Saves the in-progress report on the device so a dropped signal in a store doesn't lose answers. */
(function () {
  var VIP = (window.VIP = window.VIP || {});
  var DRAFT_KEY = 'vip.draft.v1';
  var NAME_KEY = 'vip.reporter.v1';

  function read(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function write(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (e) {
      /* storage unavailable: the form still works, it just won't remember */
    }
  }
  function remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch (e) {}
  }

  VIP.draft = {
    load: function () {
      try {
        return JSON.parse(read(DRAFT_KEY) || '{}') || {};
      } catch (e) {
        return {};
      }
    },
    save: function (values) {
      // The time seen is never saved: a stale time would be wrong the next visit.
      var copy = Object.assign({}, values);
      delete copy.seenAt;
      write(DRAFT_KEY, JSON.stringify(copy));
    },
    clear: function () {
      remove(DRAFT_KEY);
    },
    loadReporter: function () {
      return read(NAME_KEY) || '';
    },
    saveReporter: function (name) {
      if (name) write(NAME_KEY, name);
    }
  };
})();
