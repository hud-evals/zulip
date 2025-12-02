"use strict";

/**
 * Tests for DM list filtering behavior with deactivated users.
 *
 * This test verifies that conversations containing deactivated users
 * are hidden in the unzoomed DM list view but visible when zoomed.
 */

const assert = require("node:assert/strict");

const {make_realm} = require("./lib/example_realm.cjs");
const {mock_esm, zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");

const unread = mock_esm("../src/unread", {
    num_unread_mentions_for_user_ids_strings() {
        return false;
    },
});

mock_esm("../src/settings_data", {
    user_can_access_all_other_users: () => true,
});
mock_esm("../src/user_status", {
    get_status_emoji: () => undefined,
});

const people = zrequire("people");
const pm_conversations = zrequire("pm_conversations");
const pm_list_data = zrequire("pm_list_data");
const message_lists = zrequire("message_lists");
const {set_realm} = zrequire("state_data");
const {initialize_user_settings} = zrequire("user_settings");

set_realm(make_realm());
initialize_user_settings({user_settings: {}});

// User fixtures
const alice = {
    email: "alice@zulip.com",
    user_id: 101,
    full_name: "Alice",
};
const bob = {
    email: "bob@zulip.com",
    user_id: 102,
    full_name: "Bob",
};
const me = {
    email: "me@zulip.com",
    user_id: 103,
    full_name: "Me Myself",
};
const zoe = {
    email: "zoe@zulip.com",
    user_id: 104,
    full_name: "Zoe",
};
const cardelio = {
    email: "cardelio@zulip.com",
    user_id: 105,
    full_name: "Cardelio",
};
const iago = {
    email: "iago@zulip.com",
    user_id: 106,
    full_name: "Iago",
};

people.add_active_user(alice);
people.add_active_user(bob);
people.add_active_user(me);
people.add_active_user(zoe);
people.add_active_user(cardelio);
people.add_active_user(iago);
people.initialize_current_user(me.user_id);

function test(label, f) {
    run_test(label, (helpers) => {
        message_lists.set_current(undefined);
        pm_conversations.clear_for_testing();
        f(helpers);
    });
}

function check_list_info(list, length, more_unread, recipients_array) {
    assert.deepEqual(list.conversations_to_be_shown.length, length);
    assert.deepEqual(list.more_conversations_unread_count, more_unread);
    assert.deepEqual(
        list.conversations_to_be_shown.map((conversation) => conversation.recipients),
        recipients_array,
    );
}

test("deactivated_users_filtered_in_unzoomed_view", ({override}) => {
    override(unread, "num_unread_for_user_ids_string", () => 0);

    // Set up recent direct message conversations.
    pm_conversations.recent.insert([alice.user_id], 1);
    pm_conversations.recent.insert([me.user_id], 2);
    pm_conversations.recent.insert([bob.user_id], 3);
    pm_conversations.recent.insert([zoe.user_id], 4);
    pm_conversations.recent.insert([cardelio.user_id], 5);

    // Deactivate Bob.
    const bob_from_people = people.get_by_user_id(bob.user_id);
    people.deactivate(bob_from_people);

    // When only 5 direct message conversations are present
    // and Bob is deactivated, we should show only 4.
    let list_info = pm_list_data.get_list_info(false);
    // Verify that Bob (deactivated) is not included.
    check_list_info(list_info, 4, 0, ["Cardelio", "Zoe", "Me Myself", "Alice"]);

    // Set up more conversations than max_conversations_to_show
    // (which is 8), including one recent group conversation that
    // involves Bob who has been deactivated.
    pm_conversations.recent.insert([zoe.user_id, cardelio.user_id], 6);
    pm_conversations.recent.insert([bob.user_id, cardelio.user_id], 7);
    pm_conversations.recent.insert([alice.user_id, iago.user_id], 8);
    pm_conversations.recent.insert([alice.user_id, cardelio.user_id], 9);
    pm_conversations.recent.insert([zoe.user_id, iago.user_id], 10);
    pm_conversations.recent.insert([iago.user_id], 11);
    pm_conversations.recent.insert([alice.user_id, zoe.user_id], 12);
    pm_conversations.recent.insert([cardelio.user_id, iago.user_id], 13);

    // There are 13 total conversations, 2 involve Bob and are excluded.
    // From the remaining 11 conversations latest 8 are included.
    list_info = pm_list_data.get_list_info(false);
    // Verify that Bob (deactivated) is not included.
    check_list_info(list_info, 8, 0, [
        "Cardelio, Iago",
        "Alice, Zoe",
        "Iago",
        "Iago, Zoe",
        "Alice, Cardelio",
        "Alice, Iago",
        "Cardelio, Zoe",
        "Cardelio",
    ]);

    // Zooming in should reveal all direct message conversations including
    // the conversations with Bob.
    list_info = pm_list_data.get_list_info(true);
    check_list_info(list_info, 13, 0, [
        "Cardelio, Iago",
        "Alice, Zoe",
        "Iago",
        "Iago, Zoe",
        "Alice, Cardelio",
        "Alice, Iago",
        "Bob, Cardelio",
        "Cardelio, Zoe",
        "Cardelio",
        "Zoe",
        "Bob",
        "Me Myself",
        "Alice",
    ]);

    // Reactivate Bob to not affect other tests.
    people.add_active_user(bob);
});

test("deactivated_users_unread_count_tracking", ({override}) => {
    // Set up conversations with unreads.
    override(unread, "num_unread_for_user_ids_string", () => 1);

    // Set up more than 8 conversations to trigger the "more" count logic.
    pm_conversations.recent.insert([alice.user_id], 1);
    pm_conversations.recent.insert([me.user_id], 2);
    pm_conversations.recent.insert([bob.user_id], 3);
    pm_conversations.recent.insert([zoe.user_id], 4);
    pm_conversations.recent.insert([cardelio.user_id], 5);
    pm_conversations.recent.insert([zoe.user_id, cardelio.user_id], 6);
    pm_conversations.recent.insert([bob.user_id, cardelio.user_id], 7);
    pm_conversations.recent.insert([alice.user_id, iago.user_id], 8);
    pm_conversations.recent.insert([alice.user_id, cardelio.user_id], 9);
    pm_conversations.recent.insert([zoe.user_id, iago.user_id], 10);
    pm_conversations.recent.insert([iago.user_id], 11);
    pm_conversations.recent.insert([alice.user_id, zoe.user_id], 12);
    pm_conversations.recent.insert([cardelio.user_id, iago.user_id], 13);

    // Deactivate Bob.
    const bob_from_people = people.get_by_user_id(bob.user_id);
    people.deactivate(bob_from_people);

    // Verify with unread messages that conversations with Bob are still
    // not shown in the unzoomed case, and the unread count for more
    // conversations is updated for those 2 conversations.
    const list_info = pm_list_data.get_list_info(false);
    assert.deepEqual(list_info.conversations_to_be_shown.length, 11);
    assert.deepEqual(list_info.more_conversations_unread_count, 2);
    // Verify that Bob (deactivated) is not included.
    check_list_info(list_info, 11, 2, [
        "Cardelio, Iago",
        "Alice, Zoe",
        "Iago",
        "Iago, Zoe",
        "Alice, Cardelio",
        "Alice, Iago",
        "Cardelio, Zoe",
        "Cardelio",
        "Zoe",
        "Me Myself",
        "Alice",
    ]);

    // Reactivate Bob to not affect other tests.
    people.add_active_user(bob);
});

