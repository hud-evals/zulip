"use strict";

/**
 * Tests for the force_lookup parameter in bootstrap_typeahead.
 *
 * This tests that the Typeahead.lookup() method respects the force_lookup
 * parameter to bypass the empty-string check.
 */

const assert = require("node:assert/strict");

const {mock_esm, set_global, zrequire} = require("./lib/namespace.cjs");
const {run_test, noop} = require("./lib/test.cjs");
const $ = require("./lib/zjquery.cjs");

// Mock tippy which is required by bootstrap_typeahead
mock_esm("tippy.js", {
    default: () => ({
        destroy: noop,
    }),
});

// Mock text-field-edit
mock_esm("text-field-edit", {
    insert: noop,
    wrapSelection: noop,
});

set_global("document", {
    body: {},
});

// Import the Typeahead class
const {Typeahead} = zrequire("bootstrap_typeahead");

run_test("lookup with force_lookup=true bypasses empty string check", () => {
    // Track if source was called
    let source_called = false;
    let source_query = null;

    // Create a minimal input element mock
    const $input = $.create("input");
    $input.text = () => ""; // Empty query
    $input[0] = {
        focus: noop,
        selectionStart: 0,
        selectionEnd: 0,
        value: "",
    };

    const input_element = {
        $element: $input,
        type: "contenteditable",
    };

    // Create typeahead with helpOnEmptyStrings=false
    // This means without force_lookup, empty queries would be ignored
    const typeahead = new Typeahead(input_element, {
        source(query) {
            source_called = true;
            source_query = query;
            return []; // Return empty to avoid further processing
        },
        items: 5,
        helpOnEmptyStrings: false,
    });

    // Test 1: Without force_lookup, empty query should NOT call source
    source_called = false;
    typeahead.lookup(false);
    assert.ok(
        !source_called,
        "Without force_lookup, source should NOT be called for empty query",
    );

    // Test 2: With force_lookup=true, empty query SHOULD call source
    source_called = false;
    typeahead.lookup(false, true);
    assert.ok(
        source_called,
        "With force_lookup=true, source SHOULD be called even for empty query",
    );
    assert.equal(source_query, "", "Source should be called with empty query");
});

run_test("lookup without force_lookup respects helpOnEmptyStrings", () => {
    let source_called = false;

    const $input = $.create("input2");
    $input.text = () => ""; // Empty query
    $input[0] = {
        focus: noop,
        selectionStart: 0,
        selectionEnd: 0,
        value: "",
    };

    const input_element = {
        $element: $input,
        type: "contenteditable",
    };

    // Create typeahead with helpOnEmptyStrings=true
    // This means empty queries should show typeahead normally
    const typeahead = new Typeahead(input_element, {
        source() {
            source_called = true;
            return [];
        },
        items: 5,
        helpOnEmptyStrings: true,
    });

    // With helpOnEmptyStrings=true and hideOnEmpty=false, source should be called
    source_called = false;
    typeahead.lookup(false);
    assert.ok(
        source_called,
        "With helpOnEmptyStrings=true, source should be called for empty query",
    );

    // With helpOnEmptyStrings=true but hideOnEmpty=true, source should NOT be called
    source_called = false;
    typeahead.lookup(true);
    assert.ok(
        !source_called,
        "With hideOnEmpty=true, source should NOT be called even with helpOnEmptyStrings",
    );
});

