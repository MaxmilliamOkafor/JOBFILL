(function () {
    'use strict';

    // IMPORTANT: This script runs at document_start on EVERY page, so it must
    // stay completely passive on normal sites. Earlier versions globally
    // overrode HTMLInputElement.prototype.value's setter to "protect" fields
    // the user was editing. That broke React-controlled inputs and input
    // formatters across the web (e.g. HiringCafe's search box, dropdowns),
    // because legitimate site JS sets .value to a transformed/controlled value
    // and the override silently swallowed those writes, desyncing the page.
    //
    // We no longer touch the value setter at all. The only thing this script
    // does is block PROGRAMMATIC file attachment on a small, explicit list of
    // URLs where auto-attaching the saved CV is unwanted (e.g. LinkedIn's
    // resume-management settings page). The native OS file picker bypasses the
    // JS `files` setter, so the user can still upload manually on those pages.

    // Pages where JobFill (or anything else) must NOT programmatically attach a
    // file to a <input type="file">. host regex + path regex must both match.
    var FILE_UPLOAD_BLOCK_HOSTS = [
        /(^|\.)linkedin\.com$/i
    ];
    var FILE_UPLOAD_BLOCK_PATHS = [
        /\/jobs\/application-settings/i
    ];

    function shouldBlockFileUpload() {
        try {
            var host = location.hostname;
            var path = location.pathname || '';
            var hostMatch = FILE_UPLOAD_BLOCK_HOSTS.some(function (re) { return re.test(host); });
            if (!hostMatch) return false;
            return FILE_UPLOAD_BLOCK_PATHS.some(function (re) { return re.test(path); });
        } catch (e) {
            return false;
        }
    }

    if (!shouldBlockFileUpload()) {
        // Nothing to do on the vast majority of pages — stay out of the way.
        return;
    }

    try {
        var inputProto = window.HTMLInputElement && window.HTMLInputElement.prototype;
        if (!inputProto) return;

        var filesDesc;
        try {
            filesDesc = Object.getOwnPropertyDescriptor(inputProto, 'files');
        } catch (e) {
            filesDesc = null;
        }
        if (!filesDesc || !filesDesc.set || filesDesc.set.__jfFileBlocked) return;

        var origFilesSet = filesDesc.set;
        var blockedFilesSet = function (v) {
            try {
                if (this.type === 'file') {
                    // Refuse programmatic file attachment on this URL. The
                    // native file picker doesn't go through this setter, so
                    // manual uploads continue to work.
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
    } catch (e) { /* noop */ }
})();
