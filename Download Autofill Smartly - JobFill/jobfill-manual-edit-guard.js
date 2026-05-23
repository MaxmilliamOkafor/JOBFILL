(function () {
    'use strict';

    var USER_EDITED_ATTR = 'data-jf-user-edited';
    var USER_VALUE_PROP = '__jfUserValue';
    var IDLE_MS = 1500;

    function isFormControl(el) {
        if (!el || el.nodeType !== 1) return false;
        var tag = el.tagName;
        if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (tag !== 'INPUT') return false;
        var type = (el.getAttribute('type') || 'text').toLowerCase();
        return [
            'text', 'email', 'tel', 'url', 'search', 'number',
            'password', 'date', 'month', 'week', 'time',
            'datetime-local', ''
        ].indexOf(type) !== -1;
    }

    function markUserEdited(el, fromTrustedInput) {
        if (!el || !isFormControl(el)) return;
        try {
            el.setAttribute(USER_EDITED_ATTR, '1');
            el[USER_VALUE_PROP] = el.value;
            if (fromTrustedInput) el.__jfTrustedInput = true;
        } catch (e) { /* noop */ }
    }

    function clearUserEdited(el) {
        if (!el) return;
        try {
            el.removeAttribute(USER_EDITED_ATTR);
            delete el[USER_VALUE_PROP];
            delete el.__jfTrustedInput;
        } catch (e) { /* noop */ }
    }

    var idleTimer = null;
    function bumpIdle(el) {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(function () {
            // After the user pauses, treat their value as authoritative.
            if (el && el.isConnected) {
                el[USER_VALUE_PROP] = el.value;
            }
        }, IDLE_MS);
    }

    document.addEventListener('keydown', function (ev) {
        if (!ev.isTrusted) return;
        var t = ev.target;
        if (isFormControl(t)) {
            markUserEdited(t);
        }
    }, true);

    document.addEventListener('input', function (ev) {
        var t = ev.target;
        if (!isFormControl(t)) return;
        if (!ev.isTrusted) return;
        markUserEdited(t, true);
        bumpIdle(t);
    }, true);

    document.addEventListener('change', function (ev) {
        var t = ev.target;
        if (!isFormControl(t)) return;
        if (!ev.isTrusted) return;
        markUserEdited(t, true);
    }, true);

    // If the user explicitly clears a field with no value, drop the guard
    // so autofill can re-fill it on the next run.
    document.addEventListener('blur', function (ev) {
        var t = ev.target;
        if (!isFormControl(t)) return;
        if (t.value === '') clearUserEdited(t);
    }, true);

    // Restore user-typed values if a programmatic write clobbers them while
    // autofill is running. We only revert if the field was user-edited and
    // the new value differs from what the user typed.
    function watchValueProp(proto) {
        if (!proto) return;
        var desc;
        try {
            desc = Object.getOwnPropertyDescriptor(proto, 'value');
        } catch (e) { return; }
        if (!desc || !desc.set || desc.__jfWrapped) return;
        var origSet = desc.set;
        var origGet = desc.get;
        var wrappedSet = function (v) {
            // Only block programmatic writes if we have *confirmed* the user
            // typed a real keystroke into this field (a trusted input/change
            // event has fired). Anything less and we never get in autofill's
            // way.
            if (this.__jfTrustedInput === true) {
                var userVal = this[USER_VALUE_PROP];
                if (userVal !== undefined && userVal !== '' && v !== userVal) {
                    return;
                }
            }
            return origSet.call(this, v);
        };
        wrappedSet.__jfWrapped = true;
        try {
            Object.defineProperty(proto, 'value', {
                configurable: true,
                enumerable: desc.enumerable,
                get: origGet,
                set: wrappedSet
            });
        } catch (e) { /* noop */ }
    }

    try {
        watchValueProp(window.HTMLInputElement && window.HTMLInputElement.prototype);
        watchValueProp(window.HTMLTextAreaElement && window.HTMLTextAreaElement.prototype);
    } catch (e) { /* noop */ }

    // Per-URL guards: pages where we should NOT let JobFill (or anyone else)
    // programmatically attach a file to a file input.
    var FILE_UPLOAD_BLOCKLIST = [
        /(^|\.)linkedin\.com$/i  // match host
    ];
    var FILE_UPLOAD_BLOCKLIST_PATHS = [
        /\/jobs\/application-settings/i
    ];

    function shouldBlockFileUpload() {
        try {
            var host = location.hostname;
            var path = location.pathname || '';
            var hostMatch = FILE_UPLOAD_BLOCKLIST.some(function (re) { return re.test(host); });
            if (!hostMatch) return false;
            return FILE_UPLOAD_BLOCKLIST_PATHS.some(function (re) { return re.test(path); });
        } catch (e) { return false; }
    }

    if (shouldBlockFileUpload()) {
        try {
            var inputProto = window.HTMLInputElement && window.HTMLInputElement.prototype;
            if (inputProto) {
                var filesDesc;
                try {
                    filesDesc = Object.getOwnPropertyDescriptor(inputProto, 'files');
                } catch (e) { filesDesc = null; }
                if (filesDesc && filesDesc.set && !filesDesc.set.__jfFileBlocked) {
                    var origFilesSet = filesDesc.set;
                    var blockedFilesSet = function (v) {
                        try {
                            if (this.type === 'file') {
                                // Refuse programmatic file attachment on the
                                // blocked URL — only the native file picker
                                // (which bypasses this JS setter) can attach.
                                return;
                            }
                        } catch (e) { /* fall through to original setter */ }
                        return origFilesSet.call(this, v);
                    };
                    blockedFilesSet.__jfFileBlocked = true;
                    Object.defineProperty(inputProto, 'files', {
                        configurable: true,
                        enumerable: filesDesc.enumerable,
                        get: filesDesc.get,
                        set: blockedFilesSet
                    });
                }
            }
        } catch (e) { /* noop */ }
    }
})();
