(function () {
    'use strict';

    var STORAGE_KEY = 'jf-custom-fields';

    var WORK_AUTH_LABEL_CONDITION = '((work && authorization) || sponsorship || visa || permit)';
    var WORK_AUTH_OPTION_CONDITION = '(yes || authorized)';
    var WORK_AUTH_FILLING_TEXT = 'Authorized to work';

    var WORK_AUTHORIZATION_CATEGORY = {
        category_name: 'Work Authorization',
        matching_conditions: [
            {
                type: 'input',
                description: 'Work Authorization Status',
                condition: WORK_AUTH_LABEL_CONDITION,
                'input-content': WORK_AUTH_FILLING_TEXT
            },
            {
                type: 'textarea',
                description: 'Work Authorization Status',
                condition: WORK_AUTH_LABEL_CONDITION,
                'input-content': WORK_AUTH_FILLING_TEXT
            },
            {
                type: 'select',
                description: 'Work Authorization Status',
                condition: WORK_AUTH_LABEL_CONDITION,
                'option-cdn': WORK_AUTH_OPTION_CONDITION
            },
            {
                type: 'checkbox',
                description: 'Work Authorization Status',
                'option-cdn': WORK_AUTH_OPTION_CONDITION
            }
        ]
    };

    function getCategories(callback) {
        chrome.storage.local.get([STORAGE_KEY], function (result) {
            var existing = result && result[STORAGE_KEY];
            callback(Array.isArray(existing) ? existing : []);
        });
    }

    function setCategories(categories, callback) {
        var payload = {};
        payload[STORAGE_KEY] = categories;
        chrome.storage.local.set(payload, function () {
            if (typeof callback === 'function') callback();
        });
    }

    function showStatus(message, isError) {
        var el = document.getElementById('jf-extras-status');
        if (!el) return;
        el.textContent = message;
        el.className = isError
            ? 'jf-extras-status text-danger'
            : 'jf-extras-status text-success';
        el.classList.remove('d-none');
        clearTimeout(showStatus._t);
        showStatus._t = setTimeout(function () {
            el.classList.add('d-none');
        }, 4000);
    }

    function categoryHasWorkAuthorization(category) {
        if (!category || !Array.isArray(category.matching_conditions)) return false;
        return category.matching_conditions.some(function (cond) {
            var desc = (cond && cond.description ? String(cond.description) : '').toLowerCase();
            return desc.indexOf('work authorization') !== -1;
        });
    }

    function categoryCoversAllTypes(category) {
        if (!category || !Array.isArray(category.matching_conditions)) return false;
        var seen = {};
        category.matching_conditions.forEach(function (cond) {
            var desc = (cond && cond.description ? String(cond.description) : '').toLowerCase();
            if (desc.indexOf('work authorization') !== -1) seen[cond.type] = true;
        });
        return seen.input && seen.textarea && seen.select;
    }

    function ensureWorkAuthorizationPreset() {
        getCategories(function (categories) {
            var existingIdx = -1;
            for (var i = 0; i < categories.length; i++) {
                if (categoryHasWorkAuthorization(categories[i])) {
                    existingIdx = i;
                    break;
                }
            }
            var fresh = JSON.parse(JSON.stringify(WORK_AUTHORIZATION_CATEGORY));
            if (existingIdx === -1) {
                categories.push(fresh);
                setCategories(categories, function () {
                    showStatus('Added "Work Authorization Status" preset. Reloading...', false);
                    setTimeout(function () { window.location.reload(); }, 800);
                });
                return;
            }
            if (categoryCoversAllTypes(categories[existingIdx])) {
                showStatus('Work Authorization Status preset is already saved.', false);
                return;
            }
            // Upgrade an older partial preset to cover input/textarea/select/checkbox.
            var existing = categories[existingIdx];
            var existingTypes = {};
            (existing.matching_conditions || []).forEach(function (mc) {
                var desc = (mc && mc.description ? String(mc.description) : '').toLowerCase();
                if (desc.indexOf('work authorization') !== -1) existingTypes[mc.type] = true;
            });
            fresh.matching_conditions.forEach(function (mc) {
                if (!existingTypes[mc.type]) existing.matching_conditions.push(mc);
            });
            setCategories(categories, function () {
                showStatus('Updated "Work Authorization Status" preset to fill text and dropdown fields. Reloading...', false);
                setTimeout(function () { window.location.reload(); }, 800);
            });
        });
    }

    function exportAllResponses() {
        getCategories(function (categories) {
            var payload = {
                exported_at: new Date().toISOString(),
                source: 'jobfill',
                version: 1,
                categories: categories
            };
            var blob = new Blob([JSON.stringify(payload, null, 2)], {
                type: 'application/json;charset=utf-8'
            });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = 'jobfill-autofill-responses.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            showStatus('Exported ' + categories.length + ' categor' + (categories.length === 1 ? 'y' : 'ies') + '.', false);
        });
    }

    function isValidCategory(c) {
        if (!c || typeof c !== 'object') return false;
        if (typeof c.category_name !== 'string') return false;
        if (!Array.isArray(c.matching_conditions)) return false;
        return c.matching_conditions.every(function (mc) {
            if (!mc || typeof mc !== 'object') return false;
            if (typeof mc.type !== 'string') return false;
            return ['input', 'textarea', 'select', 'checkbox'].indexOf(mc.type) !== -1;
        });
    }

    function importedToCategoryArray(parsed) {
        if (Array.isArray(parsed)) return parsed;
        if (parsed && Array.isArray(parsed.categories)) return parsed.categories;
        if (parsed && typeof parsed === 'object' && parsed.category_name) return [parsed];
        return null;
    }

    function importAllResponses(file, mode) {
        var reader = new FileReader();
        reader.onload = function () {
            var parsed;
            try {
                parsed = JSON.parse(reader.result);
            } catch (err) {
                showStatus('Import failed: invalid JSON file.', true);
                return;
            }
            var imported = importedToCategoryArray(parsed);
            if (!imported) {
                showStatus('Import failed: file does not contain Autofill responses.', true);
                return;
            }
            var validImported = imported.filter(isValidCategory);
            if (validImported.length === 0) {
                showStatus('Import failed: no valid categories found.', true);
                return;
            }
            getCategories(function (existing) {
                var next;
                if (mode === 'replace') {
                    next = validImported;
                } else {
                    var existingNames = {};
                    existing.forEach(function (c) { existingNames[c.category_name] = true; });
                    next = existing.slice();
                    validImported.forEach(function (c) {
                        if (existingNames[c.category_name]) {
                            c = Object.assign({}, c, {
                                category_name: c.category_name + ' (imported)'
                            });
                        }
                        next.push(c);
                    });
                }
                setCategories(next, function () {
                    showStatus('Imported ' + validImported.length + ' categor' + (validImported.length === 1 ? 'y' : 'ies') + '. Reloading...', false);
                    setTimeout(function () { window.location.reload(); }, 800);
                });
            });
        };
        reader.onerror = function () {
            showStatus('Import failed: could not read file.', true);
        };
        reader.readAsText(file);
    }

    function init() {
        var presetBtn = document.getElementById('jf-extras-add-work-auth');
        var exportBtn = document.getElementById('jf-extras-export-all');
        var importBtn = document.getElementById('jf-extras-import-all');
        var importMergeBtn = document.getElementById('jf-extras-import-all-merge');
        var importFileInput = document.getElementById('jf-extras-import-file');

        if (presetBtn) {
            presetBtn.addEventListener('click', function (e) {
                e.preventDefault();
                ensureWorkAuthorizationPreset();
            });
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', function (e) {
                e.preventDefault();
                exportAllResponses();
            });
        }

        if (importBtn && importFileInput) {
            importBtn.addEventListener('click', function (e) {
                e.preventDefault();
                importFileInput.dataset.mode = 'replace';
                importFileInput.value = '';
                importFileInput.click();
            });
        }

        if (importMergeBtn && importFileInput) {
            importMergeBtn.addEventListener('click', function (e) {
                e.preventDefault();
                importFileInput.dataset.mode = 'merge';
                importFileInput.value = '';
                importFileInput.click();
            });
        }

        if (importFileInput) {
            importFileInput.addEventListener('change', function () {
                var file = importFileInput.files && importFileInput.files[0];
                if (!file) return;
                var mode = importFileInput.dataset.mode === 'replace' ? 'replace' : 'merge';
                if (mode === 'replace') {
                    var ok = window.confirm(
                        'Replace ALL saved Autofill responses with the contents of this file? This cannot be undone.'
                    );
                    if (!ok) return;
                }
                importAllResponses(file, mode);
            });
        }

        initProfileBackup();
    }

    // ---------- Profile backup / restore ----------

    var PROFILE_LOCAL_ALLOW_KEY_PREFIXES = ['jf-online-resume', 'use-latest-online-resume'];
    var PROFILE_LOCAL_ALLOW_KEYS_EXACT = ['jf-custom-fields'];
    var PROFILE_LOCAL_SKIP_PREFIXES = ['jf-cache-site-', 'jf-subs-h-urls', 'u-w-t'];

    function showProfileStatus(message, isError) {
        var el = document.getElementById('jf-profile-status');
        if (!el) {
            showStatus(message, isError);
            return;
        }
        el.textContent = message;
        el.className = isError
            ? 'jf-profile-status text-danger small'
            : 'jf-profile-status text-success small';
        el.classList.remove('d-none');
        clearTimeout(showProfileStatus._t);
        showProfileStatus._t = setTimeout(function () {
            el.classList.add('d-none');
        }, 5000);
    }

    function localKeyShouldBeBackedUp(key) {
        if (PROFILE_LOCAL_ALLOW_KEYS_EXACT.indexOf(key) !== -1) return true;
        for (var i = 0; i < PROFILE_LOCAL_ALLOW_KEY_PREFIXES.length; i++) {
            if (key.indexOf(PROFILE_LOCAL_ALLOW_KEY_PREFIXES[i]) === 0) return true;
        }
        for (var j = 0; j < PROFILE_LOCAL_SKIP_PREFIXES.length; j++) {
            if (key.indexOf(PROFILE_LOCAL_SKIP_PREFIXES[j]) === 0) return false;
        }
        // Default: skip unknown local keys to avoid leaking caches.
        return false;
    }

    function exportProfile() {
        chrome.storage.sync.get(null, function (syncAll) {
            chrome.storage.local.get(null, function (localAll) {
                var localFiltered = {};
                Object.keys(localAll || {}).forEach(function (k) {
                    if (localKeyShouldBeBackedUp(k)) localFiltered[k] = localAll[k];
                });

                var payload = {
                    source: 'jobfill',
                    type: 'profile-backup',
                    version: 1,
                    exported_at: new Date().toISOString(),
                    sync: syncAll || {},
                    local: localFiltered
                };

                var blob = new Blob([JSON.stringify(payload, null, 2)], {
                    type: 'application/json;charset=utf-8'
                });
                var url = URL.createObjectURL(blob);
                var a = document.createElement('a');
                var stamp = new Date().toISOString().slice(0, 10);
                a.href = url;
                a.download = 'jobfill-profile-' + stamp + '.json';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(function () { URL.revokeObjectURL(url); }, 1000);

                var syncCount = Object.keys(payload.sync).length;
                var localCount = Object.keys(payload.local).length;
                showProfileStatus(
                    'Exported profile (' + syncCount + ' sync field' + (syncCount === 1 ? '' : 's') +
                    ', ' + localCount + ' local entr' + (localCount === 1 ? 'y' : 'ies') + ').',
                    false
                );
            });
        });
    }

    function isProfileBackup(parsed) {
        if (!parsed || typeof parsed !== 'object') return false;
        if (parsed.type === 'profile-backup') return true;
        // Tolerate raw { sync, local } shapes.
        if (parsed.sync && typeof parsed.sync === 'object') return true;
        return false;
    }

    function applyProfile(parsed, mode, doneCb) {
        var sync = (parsed && parsed.sync && typeof parsed.sync === 'object') ? parsed.sync : {};
        var local = (parsed && parsed.local && typeof parsed.local === 'object') ? parsed.local : {};

        function writeSync() {
            chrome.storage.sync.set(sync, function () {
                if (chrome.runtime && chrome.runtime.lastError) {
                    showProfileStatus(
                        'Profile import: sync write failed (' + chrome.runtime.lastError.message + '). ' +
                        'Try again in a minute (Chrome rate-limits sync writes).',
                        true
                    );
                    return;
                }
                writeLocal();
            });
        }

        function writeLocal() {
            var safeLocal = {};
            Object.keys(local).forEach(function (k) {
                if (localKeyShouldBeBackedUp(k)) safeLocal[k] = local[k];
            });
            if (Object.keys(safeLocal).length === 0) {
                doneCb();
                return;
            }
            chrome.storage.local.set(safeLocal, function () {
                doneCb();
            });
        }

        if (mode === 'replace') {
            chrome.storage.sync.clear(function () {
                // Only clear local keys we manage; leave caches alone.
                chrome.storage.local.get(null, function (existing) {
                    var keysToRemove = Object.keys(existing || {}).filter(localKeyShouldBeBackedUp);
                    if (keysToRemove.length === 0) {
                        writeSync();
                        return;
                    }
                    chrome.storage.local.remove(keysToRemove, function () {
                        writeSync();
                    });
                });
            });
        } else {
            writeSync();
        }
    }

    function importProfile(file, mode) {
        var reader = new FileReader();
        reader.onload = function () {
            var parsed;
            try {
                parsed = JSON.parse(reader.result);
            } catch (err) {
                showProfileStatus('Import failed: invalid JSON file.', true);
                return;
            }
            if (!isProfileBackup(parsed)) {
                showProfileStatus('Import failed: file is not a JobFill profile backup.', true);
                return;
            }
            applyProfile(parsed, mode, function () {
                showProfileStatus('Profile imported. Reloading...', false);
                setTimeout(function () { window.location.reload(); }, 900);
            });
        };
        reader.onerror = function () {
            showProfileStatus('Import failed: could not read file.', true);
        };
        reader.readAsText(file);
    }

    function initProfileBackup() {
        var exportBtn = document.getElementById('jf-profile-export');
        var importMergeBtn = document.getElementById('jf-profile-import-merge');
        var importReplaceBtn = document.getElementById('jf-profile-import-replace');
        var fileInput = document.getElementById('jf-profile-import-file');

        if (exportBtn) {
            exportBtn.addEventListener('click', function (e) {
                e.preventDefault();
                exportProfile();
            });
        }

        if (importMergeBtn && fileInput) {
            importMergeBtn.addEventListener('click', function (e) {
                e.preventDefault();
                fileInput.dataset.mode = 'merge';
                fileInput.value = '';
                fileInput.click();
            });
        }

        if (importReplaceBtn && fileInput) {
            importReplaceBtn.addEventListener('click', function (e) {
                e.preventDefault();
                fileInput.dataset.mode = 'replace';
                fileInput.value = '';
                fileInput.click();
            });
        }

        if (fileInput) {
            fileInput.addEventListener('change', function () {
                var file = fileInput.files && fileInput.files[0];
                if (!file) return;
                var mode = fileInput.dataset.mode === 'replace' ? 'replace' : 'merge';
                if (mode === 'replace') {
                    var ok = window.confirm(
                        'Replace ALL profile information (personal info, additional info, education, work experience, custom fields, resume) with the contents of this file? This cannot be undone.'
                    );
                    if (!ok) return;
                }
                importProfile(file, mode);
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
