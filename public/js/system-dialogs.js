/**
 * Themed in-browser replacements for alert(), confirm(), prompt().
 * Uses design-system modal and tokens; returns Promises.
 */
(function () {
  var overlay = null;
  var resolveCurrent = null;

  function getOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay hidden';
    overlay.id = 'sys-dialog-overlay';
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('role', 'dialog');
    document.body.appendChild(overlay);
    return overlay;
  }

  function show(content, resolveWith) {
    var el = getOverlay();
    el.innerHTML = '';
    el.appendChild(content);
    el.classList.remove('hidden');
    return new Promise(function (resolve) {
      resolveCurrent = function (value) {
        el.classList.add('hidden');
        resolveCurrent = null;
        resolve(value);
      };
    });
  }

  function escapeText(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  window.showAlert = function (message) {
    var title = 'ONE21';
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML =
      '<div class="modal__header">' +
        '<span class="modal__title">' + escapeText(title) + '</span>' +
      '</div>' +
      '<div class="modal__body">' +
        '<p class="sys-dialog__message">' + escapeText(message) + '</p>' +
      '</div>' +
      '<div class="modal__footer">' +
        '<button type="button" class="btn btn--primary btn--sm" data-sys-dialog="ok">OK</button>' +
      '</div>';
    modal.querySelector('[data-sys-dialog="ok"]').addEventListener('click', function () {
      if (resolveCurrent) resolveCurrent(undefined);
    });
    return show(modal).then(function () {});
  };

  window.showConfirm = function (message, options) {
    options = options || {};
    var destructive = options.destructive === true;
    var title = options.title != null ? options.title : 'ONE21';
    var okLabel = options.okLabel != null ? options.okLabel : 'OK';
    var cancelLabel = options.cancelLabel != null ? options.cancelLabel : 'Cancel';
    var modal = document.createElement('div');
    modal.className = 'modal';
    var okClass = destructive ? 'btn btn--danger btn--sm' : 'btn btn--primary btn--sm';
    modal.innerHTML =
      '<div class="modal__header">' +
        '<span class="modal__title">' + escapeText(title) + '</span>' +
      '</div>' +
      '<div class="modal__body">' +
        '<p class="sys-dialog__message">' + escapeText(message) + '</p>' +
      '</div>' +
      '<div class="modal__footer">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-sys-dialog="cancel">' + escapeText(cancelLabel) + '</button>' +
        '<button type="button" class="' + okClass + '" data-sys-dialog="ok">' + escapeText(okLabel) + '</button>' +
      '</div>';
    modal.querySelector('[data-sys-dialog="ok"]').addEventListener('click', function () {
      if (resolveCurrent) resolveCurrent(true);
    });
    modal.querySelector('[data-sys-dialog="cancel"]').addEventListener('click', function () {
      if (resolveCurrent) resolveCurrent(false);
    });
    return show(modal).then(function (v) { return v === true; });
  };

  window.showPrompt = function (message, defaultValue, options) {
    options = options || {};
    var title = options.title != null ? options.title : 'ONE21';
    defaultValue = defaultValue != null ? String(defaultValue) : '';
    var modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML =
      '<div class="modal__header">' +
        '<span class="modal__title">' + escapeText(title) + '</span>' +
      '</div>' +
      '<div class="modal__body">' +
        '<p class="sys-dialog__message sys-dialog__message--with-input">' + escapeText(message) + '</p>' +
        '<div class="modal__field">' +
          '<input type="text" class="modal__input" id="sys-dialog-prompt-input" value="' + escapeText(defaultValue) + '" />' +
        '</div>' +
      '</div>' +
      '<div class="modal__footer">' +
        '<button type="button" class="btn btn--ghost btn--sm" data-sys-dialog="cancel">Cancel</button>' +
        '<button type="button" class="btn btn--primary btn--sm" data-sys-dialog="ok">OK</button>' +
      '</div>';
    var input = modal.querySelector('#sys-dialog-prompt-input');
    modal.querySelector('[data-sys-dialog="ok"]').addEventListener('click', function () {
      if (resolveCurrent) resolveCurrent(input.value);
    });
    modal.querySelector('[data-sys-dialog="cancel"]').addEventListener('click', function () {
      if (resolveCurrent) resolveCurrent(null);
    });
    var promise = show(modal).then(function (v) { return v !== undefined ? v : null; });
    setTimeout(function () {
      input.focus();
      input.select();
    }, 50);
    return promise;
  };
})();
