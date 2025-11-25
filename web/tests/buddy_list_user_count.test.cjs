"use strict";

// Tests for the sidebar "other subscribers" count calculation.
// This validates that the count correctly excludes:
// - Bot participants
// - Unsubscribed participants
// And handles edge cases like DM views, all participants, no participants.

const assert = require("node:assert/strict");

const {zrequire} = require("./lib/namespace.cjs");
const {run_test} = require("./lib/test.cjs");
const $ = require("./lib/zjquery.cjs");

const {BuddyList} = zrequire("buddy_list");
const peer_data = zrequire("peer_data");
const people = zrequire("people");
const {set_realm} = zrequire("state_data");
const stream_data = zrequire("stream_data");
const {initialize_user_settings} = zrequire("user_settings");

set_realm({});
initialize_user_settings({user_settings: {}});

// Helper to set up DOM stubs for section header count tests
function stub_buddy_list_section_headers() {
    // Stub the section heading elements that update_section_header_counts() writes to
    $("#buddy-list-participants-container .buddy-list-heading-user-count").text("");
    $("#buddy-list-users-matching-view-container .buddy-list-heading-user-count").text("");
    $("#buddy-list-other-users-container .buddy-list-heading-user-count").text("");
    $("#buddy-list-participants-section-heading").attr("data-user-count", undefined);
    $("#buddy-list-users-matching-view-section-heading").attr("data-user-count", undefined);
    $("#buddy-list-users-other-users-section-heading").attr("data-user-count", undefined);
}

// Test A: 5 subscribers, 2 human participants -> 3 other subscribers
run_test("other subscribers count with human participants", () => {
    const buddy_list = new BuddyList();
    stub_buddy_list_section_headers();

    const stream_id = 1001;
    const sub = {name: "Test Stream", subscribed: true, stream_id};
    stream_data.clear_subscriptions();
    peer_data.clear_for_testing();
    stream_data.add_sub(sub);

    const human1 = {email: "human1@zulip.com", user_id: 501, full_name: "Human One"};
    const human2 = {email: "human2@zulip.com", user_id: 502, full_name: "Human Two"};
    const human3 = {email: "human3@zulip.com", user_id: 503, full_name: "Human Three"};
    const human4 = {email: "human4@zulip.com", user_id: 504, full_name: "Human Four"};
    const human5 = {email: "human5@zulip.com", user_id: 505, full_name: "Human Five"};

    people.add_active_user(human1);
    people.add_active_user(human2);
    people.add_active_user(human3);
    people.add_active_user(human4);
    people.add_active_user(human5);

    peer_data.set_subscribers(stream_id, [
        human1.user_id,
        human2.user_id,
        human3.user_id,
        human4.user_id,
        human5.user_id,
    ]);

    const participant_ids = new Set([human1.user_id, human2.user_id]);
    buddy_list.render_data = {
        current_sub: sub,
        pm_ids_set: new Set(),
        total_human_subscribers_count: 5,
        other_users_count: 0,
        hide_headers: false,
        get_all_participant_ids: () => participant_ids,
    };

    // Test observable behavior: the count shown in section header
    buddy_list.update_section_header_counts();
    const displayed_count = $("#buddy-list-users-matching-view-section-heading").attr(
        "data-user-count",
    );
    assert.equal(displayed_count, 3);
});

// Test B: 5 subscribers, 1 human + 1 bot participant -> 4 other subscribers (bot excluded)
run_test("other subscribers count excludes bot participants", () => {
    const buddy_list = new BuddyList();
    stub_buddy_list_section_headers();

    const stream_id = 1002;
    const sub = {name: "Test Stream 2", subscribed: true, stream_id};
    stream_data.clear_subscriptions();
    peer_data.clear_for_testing();
    stream_data.add_sub(sub);

    const human1 = {email: "h1@zulip.com", user_id: 601, full_name: "H One"};
    const human2 = {email: "h2@zulip.com", user_id: 602, full_name: "H Two"};
    const human3 = {email: "h3@zulip.com", user_id: 603, full_name: "H Three"};
    const human4 = {email: "h4@zulip.com", user_id: 604, full_name: "H Four"};
    const human5 = {email: "h5@zulip.com", user_id: 605, full_name: "H Five"};
    const bot_user = {
        email: "bot@zulip.com",
        user_id: 650,
        full_name: "Test Bot",
        is_bot: true,
        bot_type: 1,
        bot_owner_id: null,
    };

    people.add_active_user(human1);
    people.add_active_user(human2);
    people.add_active_user(human3);
    people.add_active_user(human4);
    people.add_active_user(human5);
    people.add_active_user(bot_user);

    peer_data.set_subscribers(stream_id, [
        human1.user_id,
        human2.user_id,
        human3.user_id,
        human4.user_id,
        human5.user_id,
    ]);

    // 2 participants: 1 human subscriber + 1 bot
    // Bug would count: 5 - 2 = 3; Correct: 5 - 1 = 4
    const participant_ids = new Set([human1.user_id, bot_user.user_id]);
    buddy_list.render_data = {
        current_sub: sub,
        pm_ids_set: new Set(),
        total_human_subscribers_count: 5,
        other_users_count: 0,
        hide_headers: false,
        get_all_participant_ids: () => participant_ids,
    };

    buddy_list.update_section_header_counts();
    const displayed_count = $("#buddy-list-users-matching-view-section-heading").attr(
        "data-user-count",
    );
    assert.equal(displayed_count, 4);
});

// Test C: 5 subscribers, 1 subscriber + 1 unsubscribed participant -> 4 (unsubscribed excluded)
run_test("other subscribers count excludes unsubscribed participants", () => {
    const buddy_list = new BuddyList();
    stub_buddy_list_section_headers();

    const stream_id = 1003;
    const sub = {name: "Test Stream 3", subscribed: true, stream_id};
    stream_data.clear_subscriptions();
    peer_data.clear_for_testing();
    stream_data.add_sub(sub);

    const subscriber1 = {email: "sub1@zulip.com", user_id: 701, full_name: "Subscriber One"};
    const subscriber2 = {email: "sub2@zulip.com", user_id: 702, full_name: "Subscriber Two"};
    const subscriber3 = {email: "sub3@zulip.com", user_id: 703, full_name: "Subscriber Three"};
    const subscriber4 = {email: "sub4@zulip.com", user_id: 704, full_name: "Subscriber Four"};
    const subscriber5 = {email: "sub5@zulip.com", user_id: 705, full_name: "Subscriber Five"};
    const former_subscriber = {
        email: "former@zulip.com",
        user_id: 710,
        full_name: "Former Subscriber",
    };

    people.add_active_user(subscriber1);
    people.add_active_user(subscriber2);
    people.add_active_user(subscriber3);
    people.add_active_user(subscriber4);
    people.add_active_user(subscriber5);
    people.add_active_user(former_subscriber);

    // former_subscriber is NOT in subscriber list
    peer_data.set_subscribers(stream_id, [
        subscriber1.user_id,
        subscriber2.user_id,
        subscriber3.user_id,
        subscriber4.user_id,
        subscriber5.user_id,
    ]);

    // Bug would count: 5 - 2 = 3; Correct: 5 - 1 = 4
    const participant_ids = new Set([subscriber1.user_id, former_subscriber.user_id]);
    buddy_list.render_data = {
        current_sub: sub,
        pm_ids_set: new Set(),
        total_human_subscribers_count: 5,
        other_users_count: 0,
        hide_headers: false,
        get_all_participant_ids: () => participant_ids,
    };

    buddy_list.update_section_header_counts();
    const displayed_count = $("#buddy-list-users-matching-view-section-heading").attr(
        "data-user-count",
    );
    assert.equal(displayed_count, 4);
});

// Test D: DM view (no current_sub) - should return total human participants
run_test("DM view returns total human participants count", () => {
    const buddy_list = new BuddyList();
    stub_buddy_list_section_headers();

    const dm_user1 = {email: "dm1@zulip.com", user_id: 801, full_name: "DM User 1"};
    const dm_user2 = {email: "dm2@zulip.com", user_id: 802, full_name: "DM User 2"};
    const dm_user3 = {email: "dm3@zulip.com", user_id: 803, full_name: "DM User 3"};

    people.add_active_user(dm_user1);
    people.add_active_user(dm_user2);
    people.add_active_user(dm_user3);

    // DM view: current_sub is undefined
    const participant_ids = new Set([dm_user1.user_id, dm_user2.user_id, dm_user3.user_id]);
    buddy_list.render_data = {
        current_sub: undefined,
        pm_ids_set: new Set([dm_user1.user_id, dm_user2.user_id, dm_user3.user_id]),
        total_human_subscribers_count: 3,
        other_users_count: 0,
        hide_headers: false,
        get_all_participant_ids: () => participant_ids,
    };

    buddy_list.update_section_header_counts();
    const displayed_count = $("#buddy-list-users-matching-view-section-heading").attr(
        "data-user-count",
    );
    // For DMs, the count should be total_human_subscribers_count (all DM participants)
    assert.equal(displayed_count, 3);
});

// Test E: Subscribed bot as participant - should still be excluded (we count humans only)
run_test("subscribed bot participant excluded from count", () => {
    const buddy_list = new BuddyList();
    stub_buddy_list_section_headers();

    const stream_id = 1004;
    const sub = {name: "Test Stream 4", subscribed: true, stream_id};
    stream_data.clear_subscriptions();
    peer_data.clear_for_testing();
    stream_data.add_sub(sub);

    const human1 = {email: "hum1@zulip.com", user_id: 901, full_name: "Human 1"};
    const human2 = {email: "hum2@zulip.com", user_id: 902, full_name: "Human 2"};
    const human3 = {email: "hum3@zulip.com", user_id: 903, full_name: "Human 3"};
    const human4 = {email: "hum4@zulip.com", user_id: 904, full_name: "Human 4"};
    const human5 = {email: "hum5@zulip.com", user_id: 905, full_name: "Human 5"};
    const subscribed_bot = {
        email: "subbot@zulip.com",
        user_id: 950,
        full_name: "Subscribed Bot",
        is_bot: true,
        bot_type: 1,
        bot_owner_id: null,
    };

    people.add_active_user(human1);
    people.add_active_user(human2);
    people.add_active_user(human3);
    people.add_active_user(human4);
    people.add_active_user(human5);
    people.add_active_user(subscribed_bot);

    // Bot is subscribed but total_human_subscribers_count is still 5 (humans only)
    peer_data.set_subscribers(stream_id, [
        human1.user_id,
        human2.user_id,
        human3.user_id,
        human4.user_id,
        human5.user_id,
        subscribed_bot.user_id,
    ]);

    // Only the subscribed bot is a participant
    const participant_ids = new Set([subscribed_bot.user_id]);
    buddy_list.render_data = {
        current_sub: sub,
        pm_ids_set: new Set(),
        total_human_subscribers_count: 5,
        other_users_count: 0,
        hide_headers: false,
        get_all_participant_ids: () => participant_ids,
    };

    buddy_list.update_section_header_counts();
    const displayed_count = $("#buddy-list-users-matching-view-section-heading").attr(
        "data-user-count",
    );
    // Bot excluded, so all 5 human subscribers are "other subscribers"
    assert.equal(displayed_count, 5);
});

// Test F: Combined - 1 human subscriber + 1 bot + 1 unsubscribed as participants
run_test("combined: only human subscriber participant affects count", () => {
    const buddy_list = new BuddyList();
    stub_buddy_list_section_headers();

    const stream_id = 1005;
    const sub = {name: "Test Stream 5", subscribed: true, stream_id};
    stream_data.clear_subscriptions();
    peer_data.clear_for_testing();
    stream_data.add_sub(sub);

    const human1 = {email: "combo1@zulip.com", user_id: 1001, full_name: "Combo Human 1"};
    const human2 = {email: "combo2@zulip.com", user_id: 1002, full_name: "Combo Human 2"};
    const human3 = {email: "combo3@zulip.com", user_id: 1003, full_name: "Combo Human 3"};
    const human4 = {email: "combo4@zulip.com", user_id: 1004, full_name: "Combo Human 4"};
    const human5 = {email: "combo5@zulip.com", user_id: 1005, full_name: "Combo Human 5"};
    const bot_participant = {
        email: "combobot@zulip.com",
        user_id: 1050,
        full_name: "Combo Bot",
        is_bot: true,
        bot_type: 1,
        bot_owner_id: null,
    };
    const unsubscribed_participant = {
        email: "combounsub@zulip.com",
        user_id: 1060,
        full_name: "Combo Unsubscribed",
    };

    people.add_active_user(human1);
    people.add_active_user(human2);
    people.add_active_user(human3);
    people.add_active_user(human4);
    people.add_active_user(human5);
    people.add_active_user(bot_participant);
    people.add_active_user(unsubscribed_participant);

    peer_data.set_subscribers(stream_id, [
        human1.user_id,
        human2.user_id,
        human3.user_id,
        human4.user_id,
        human5.user_id,
    ]);

    // 3 participants: 1 human subscriber + 1 bot + 1 unsubscribed human
    // Bug would count: 5 - 3 = 2; Correct: 5 - 1 = 4
    const participant_ids = new Set([
        human1.user_id,
        bot_participant.user_id,
        unsubscribed_participant.user_id,
    ]);
    buddy_list.render_data = {
        current_sub: sub,
        pm_ids_set: new Set(),
        total_human_subscribers_count: 5,
        other_users_count: 0,
        hide_headers: false,
        get_all_participant_ids: () => participant_ids,
    };

    buddy_list.update_section_header_counts();
    const displayed_count = $("#buddy-list-users-matching-view-section-heading").attr(
        "data-user-count",
    );
    assert.equal(displayed_count, 4);
});

// Test G: All subscribers are participants -> 0 other subscribers
run_test("all subscribers are participants shows zero others", () => {
    const buddy_list = new BuddyList();
    stub_buddy_list_section_headers();

    const stream_id = 1006;
    const sub = {name: "Test Stream 6", subscribed: true, stream_id};
    stream_data.clear_subscriptions();
    peer_data.clear_for_testing();
    stream_data.add_sub(sub);

    const human1 = {email: "all1@zulip.com", user_id: 1101, full_name: "All Human 1"};
    const human2 = {email: "all2@zulip.com", user_id: 1102, full_name: "All Human 2"};
    const human3 = {email: "all3@zulip.com", user_id: 1103, full_name: "All Human 3"};

    people.add_active_user(human1);
    people.add_active_user(human2);
    people.add_active_user(human3);

    peer_data.set_subscribers(stream_id, [human1.user_id, human2.user_id, human3.user_id]);

    // All 3 subscribers are participants
    const participant_ids = new Set([human1.user_id, human2.user_id, human3.user_id]);
    buddy_list.render_data = {
        current_sub: sub,
        pm_ids_set: new Set(),
        total_human_subscribers_count: 3,
        other_users_count: 0,
        hide_headers: false,
        get_all_participant_ids: () => participant_ids,
    };

    buddy_list.update_section_header_counts();
    const displayed_count = $("#buddy-list-users-matching-view-section-heading").attr(
        "data-user-count",
    );
    assert.equal(displayed_count, 0);
});

// Test H: No participants at all -> all subscribers are "other"
run_test("no participants shows all subscribers as others", () => {
    const buddy_list = new BuddyList();
    stub_buddy_list_section_headers();

    const stream_id = 1007;
    const sub = {name: "Test Stream 7", subscribed: true, stream_id};
    stream_data.clear_subscriptions();
    peer_data.clear_for_testing();
    stream_data.add_sub(sub);

    const human1 = {email: "none1@zulip.com", user_id: 1201, full_name: "None Human 1"};
    const human2 = {email: "none2@zulip.com", user_id: 1202, full_name: "None Human 2"};
    const human3 = {email: "none3@zulip.com", user_id: 1203, full_name: "None Human 3"};
    const human4 = {email: "none4@zulip.com", user_id: 1204, full_name: "None Human 4"};
    const human5 = {email: "none5@zulip.com", user_id: 1205, full_name: "None Human 5"};

    people.add_active_user(human1);
    people.add_active_user(human2);
    people.add_active_user(human3);
    people.add_active_user(human4);
    people.add_active_user(human5);

    peer_data.set_subscribers(stream_id, [
        human1.user_id,
        human2.user_id,
        human3.user_id,
        human4.user_id,
        human5.user_id,
    ]);

    // No participants
    const participant_ids = new Set();
    buddy_list.render_data = {
        current_sub: sub,
        pm_ids_set: new Set(),
        total_human_subscribers_count: 5,
        other_users_count: 0,
        hide_headers: false,
        get_all_participant_ids: () => participant_ids,
    };

    buddy_list.update_section_header_counts();
    const displayed_count = $("#buddy-list-users-matching-view-section-heading").attr(
        "data-user-count",
    );
    assert.equal(displayed_count, 5);
});

