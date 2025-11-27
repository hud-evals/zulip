"use strict";

/**
 * Tests for user pill unique name functionality.
 *
 * This tests the behavior of:
 * - Unique full name disambiguation for users with duplicate names
 * - Typeahead handling for `name|user_id` syntax
 * - Pill text serialization for duplicate names
 */

const assert = require("node:assert/strict");

const {mock_esm, zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");

const muted_users = zrequire("muted_users");
const people = zrequire("people");
const user_groups = zrequire("user_groups");
const {set_current_user, set_realm} = zrequire("state_data");
const {initialize_user_settings} = zrequire("user_settings");
const settings_config = zrequire("settings_config");

// Mock modules that are needed but not directly tested
const message_user_ids = mock_esm("../src/message_user_ids", {
    user_ids: () => [],
});
mock_esm("../src/compose_pm_pill", {
    filter_taken_users: (users) => users,
});
const settings_data = mock_esm("../src/settings_data", {
    user_can_access_all_other_users: () => true,
});

// Initialize state
const current_user = {};
set_current_user(current_user);
const realm = {};
set_realm(realm);
const user_settings = {
    web_channel_default_view: settings_config.web_channel_default_view_values.channel_feed.code,
};
initialize_user_settings({user_settings});

// Now we can zrequire modules that depend on state
const composebox_typeahead = zrequire("composebox_typeahead");
const user_pill = zrequire("user_pill");

// Test users
const alice = {
    email: "alice@example.com",
    user_id: 101,
    full_name: "Alice Smith",
    is_moderator: false,
    is_bot: false,
};

const bob = {
    email: "bob@example.com",
    user_id: 102,
    full_name: "Bob Jones",
    is_moderator: false,
    is_bot: false,
};

// Two users with the same full name (duplicates)
const twin1 = {
    email: "twin1@example.com",
    user_id: 201,
    full_name: "Mark Twin",
    is_moderator: false,
    is_bot: false,
};

const twin2 = {
    email: "twin2@example.com",
    user_id: 202,
    full_name: "Mark Twin",
    is_moderator: false,
    is_bot: false,
};

// User for testing invalid user_id scenarios
const charlie = {
    email: "charlie@example.com",
    user_id: 301,
    full_name: "Charlie Brown",
    is_moderator: false,
    is_bot: false,
};

// User groups setup
const nobody = {
    name: "role:nobody",
    id: 1,
    members: new Set([]),
    is_system_group: true,
    direct_subgroup_ids: new Set([]),
};

const everyone = {
    name: "role:everyone",
    id: 2,
    members: new Set([101, 102, 201, 202, 301]),
    is_system_group: true,
    direct_subgroup_ids: new Set([]),
};

function user_item(user) {
    return {type: "user", user};
}

function initialize_test() {
    people.init();
    muted_users.set_muted_users([]);
    user_groups.init();
    user_groups.add(nobody);
    user_groups.add(everyone);
}

// Helper to add user as both active and valid
function add_user(user) {
    people.add_active_user(user);
    people.add_valid_user_id(user.user_id);
}

// Test get_unique_full_name functionality
run_test("get_unique_full_name returns plain name for unique users", () => {
    initialize_test();

    add_user(alice);
    add_user(bob);
    people.initialize_current_user(alice.user_id);

    // For users with unique names, should return just the name
    const unique_name = people.get_unique_full_name(alice.full_name, alice.user_id);
    assert.equal(unique_name, "Alice Smith");

    const unique_name_bob = people.get_unique_full_name(bob.full_name, bob.user_id);
    assert.equal(unique_name_bob, "Bob Jones");
});

run_test("get_unique_full_name returns name|id for duplicate names", () => {
    initialize_test();

    add_user(twin1);
    add_user(twin2);
    people.initialize_current_user(twin1.user_id);

    // Both users have the same name, so should include user_id
    assert.ok(people.is_duplicate_full_name("Mark Twin"));

    const unique_name_1 = people.get_unique_full_name(twin1.full_name, twin1.user_id);
    assert.equal(unique_name_1, "Mark Twin|201");

    const unique_name_2 = people.get_unique_full_name(twin2.full_name, twin2.user_id);
    assert.equal(unique_name_2, "Mark Twin|202");
});

// Test get_from_unique_full_name functionality
run_test("get_from_unique_full_name parses name|id syntax correctly", () => {
    initialize_test();

    add_user(alice);
    add_user(twin1);
    add_user(twin2);
    people.initialize_current_user(alice.user_id);

    // Should parse the name|id syntax and return the correct user
    const user1 = people.get_from_unique_full_name(`Mark Twin|${twin1.user_id}`);
    assert.ok(user1);
    assert.equal(user1.user_id, twin1.user_id);

    const user2 = people.get_from_unique_full_name(`Mark Twin|${twin2.user_id}`);
    assert.ok(user2);
    assert.equal(user2.user_id, twin2.user_id);

    // Should also work for non-duplicate names
    const alice_parsed = people.get_from_unique_full_name(`Alice Smith|${alice.user_id}`);
    assert.ok(alice_parsed);
    assert.equal(alice_parsed.user_id, alice.user_id);
});

run_test("get_from_unique_full_name returns undefined for invalid syntax", () => {
    initialize_test();

    add_user(alice);
    people.initialize_current_user(alice.user_id);

    // Should return undefined for plain names (no pipe)
    const plain_name = people.get_from_unique_full_name("Alice Smith");
    assert.equal(plain_name, undefined);

    // Should return undefined for invalid user_id
    const invalid_id = people.get_from_unique_full_name("Alice Smith|99999");
    assert.equal(invalid_id, undefined);

    // Should return undefined for non-numeric id
    const non_numeric = people.get_from_unique_full_name("Alice Smith|abc");
    assert.equal(non_numeric, undefined);

    // Should return undefined for empty string
    const empty = people.get_from_unique_full_name("");
    assert.equal(empty, undefined);

    // Should return undefined for multiple pipes
    const multiple_pipes = people.get_from_unique_full_name("Some|Name|123");
    assert.equal(multiple_pipes, undefined);
});

// Test typeahead behavior with name|id syntax
run_test("typeahead returns correct user for name|id query", ({override}) => {
    initialize_test();

    add_user(alice);
    add_user(twin1);
    add_user(twin2);
    people.initialize_current_user(alice.user_id);

    override(realm, "realm_can_access_all_users_group", everyone.id);
    override(message_user_ids, "user_ids", () => []);

    const opts = {
        want_broadcast: false,
        want_groups: false,
        filter_pills: false,
    };

    // Searching for "Mark Twin|201" should return twin1 specifically
    const results1 = composebox_typeahead.get_person_suggestions(
        `${twin1.full_name}|${twin1.user_id}`,
        opts,
    );
    assert.equal(results1.length, 1);
    assert.deepEqual(results1, [user_item(twin1)]);

    // Searching for "Mark Twin|202" should return twin2 specifically
    const results2 = composebox_typeahead.get_person_suggestions(
        `${twin2.full_name}|${twin2.user_id}`,
        opts,
    );
    assert.equal(results2.length, 1);
    assert.deepEqual(results2, [user_item(twin2)]);

    // Should also work for unique names with id
    const results_alice = composebox_typeahead.get_person_suggestions(
        `${alice.full_name}|${alice.user_id}`,
        opts,
    );
    assert.equal(results_alice.length, 1);
    assert.deepEqual(results_alice, [user_item(alice)]);
});

run_test("typeahead returns empty for invalid user_id in name|id query", ({override}) => {
    initialize_test();

    add_user(charlie);
    people.initialize_current_user(charlie.user_id);

    override(realm, "realm_can_access_all_users_group", everyone.id);
    override(message_user_ids, "user_ids", () => []);

    const opts = {
        want_broadcast: false,
        want_groups: false,
        filter_pills: false,
    };

    // Searching with invalid user_id should return empty
    const results = composebox_typeahead.get_person_suggestions("Charlie Brown|99999", opts);
    assert.deepEqual(results, []);

    // Searching with non-numeric id should also return empty (falls through to regular search)
    const results_non_numeric = composebox_typeahead.get_person_suggestions(
        "Charlie Brown|abc",
        opts,
    );
    // This should not match via the unique name syntax, and "Charlie Brown|abc" won't
    // match Charlie Brown via regular typeahead either
    assert.deepEqual(results_non_numeric, []);
});

// Test user_pill text serialization for duplicate names
run_test("get_unique_full_name_from_item returns name|id for duplicates", () => {
    initialize_test();

    add_user(twin1);
    add_user(twin2);
    people.initialize_current_user(twin1.user_id);

    // Create pill items
    const pill_item_1 = {
        type: "user",
        user_id: twin1.user_id,
        full_name: twin1.full_name,
        email: twin1.email,
    };

    const pill_item_2 = {
        type: "user",
        user_id: twin2.user_id,
        full_name: twin2.full_name,
        email: twin2.email,
    };

    // Should return name|id for users with duplicate names
    const text1 = user_pill.get_unique_full_name_from_item(pill_item_1);
    assert.equal(text1, "Mark Twin|201");

    const text2 = user_pill.get_unique_full_name_from_item(pill_item_2);
    assert.equal(text2, "Mark Twin|202");
});

run_test("get_unique_full_name_from_item returns plain name for unique users", () => {
    initialize_test();

    add_user(alice);
    add_user(bob);
    people.initialize_current_user(alice.user_id);

    const pill_item_alice = {
        type: "user",
        user_id: alice.user_id,
        full_name: alice.full_name,
        email: alice.email,
    };

    const pill_item_bob = {
        type: "user",
        user_id: bob.user_id,
        full_name: bob.full_name,
        email: bob.email,
    };

    // Should return plain name for users with unique names
    const text_alice = user_pill.get_unique_full_name_from_item(pill_item_alice);
    assert.equal(text_alice, "Alice Smith");

    const text_bob = user_pill.get_unique_full_name_from_item(pill_item_bob);
    assert.equal(text_bob, "Bob Jones");
});

// Test create_item_from_user_id functionality
run_test("create_item_from_user_id creates pill from user_id string", () => {
    initialize_test();

    add_user(alice);
    people.initialize_current_user(alice.user_id);

    // Should create a pill item from user_id string
    const item = user_pill.create_item_from_user_id(alice.user_id.toString(), []);

    assert.ok(item);
    assert.equal(item.type, "user");
    assert.equal(item.user_id, alice.user_id);
    assert.equal(item.full_name, alice.full_name);
    assert.equal(item.email, alice.email);
});

run_test("create_item_from_user_id returns undefined for invalid user_id", () => {
    initialize_test();

    add_user(alice);
    people.initialize_current_user(alice.user_id);

    // Should return undefined for non-existent user_id
    const item = user_pill.create_item_from_user_id("99999", []);
    assert.equal(item, undefined);

    // Should return undefined for non-numeric string
    const item_non_numeric = user_pill.create_item_from_user_id("abc", []);
    assert.equal(item_non_numeric, undefined);
});

run_test("create_item_from_user_id prevents duplicates", () => {
    initialize_test();

    add_user(alice);
    people.initialize_current_user(alice.user_id);

    // Create an existing item
    const existing_item = {
        type: "user",
        user_id: alice.user_id,
        full_name: alice.full_name,
        email: alice.email,
    };

    // Should return undefined if user is already in the list
    const item = user_pill.create_item_from_user_id(alice.user_id.toString(), [existing_item]);
    assert.equal(item, undefined);
});

