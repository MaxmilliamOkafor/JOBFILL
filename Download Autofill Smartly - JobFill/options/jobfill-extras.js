(function () {
    'use strict';

    var STORAGE_KEY = 'jf-custom-fields';

    var WORK_AUTHORIZATION_CATEGORY = {
        category_name: 'Work Authorization',
        matching_conditions: [
            {
                type: 'select',
                description: 'Work Authorization Status',
                condition: '((work && authorization) || sponsorship || visa || permit)',
                'option-cdn': '(yes || authorized)'
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

    function ensureWorkAuthorizationPreset() {
        getCategories(function (categories) {
            var alreadyPresent = categories.some(categoryHasWorkAuthorization);
            if (alreadyPresent) {
                showStatus('Work Authorization Status preset is already saved.', false);
                return;
            }
            categories.push(JSON.parse(JSON.stringify(WORK_AUTHORIZATION_CATEGORY)));
            setCategories(categories, function () {
                showStatus('Added "Work Authorization Status" preset. Reloading...', false);
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
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
