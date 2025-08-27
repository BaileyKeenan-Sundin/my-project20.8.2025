<?php
/*
Plugin Name: Example (Events API)
Description: Event CPT + REST + single webhook AFTER post+meta save (full payload, de-duplicated).
Version: 1.6.0
Author: You
*/

if (!defined('ABSPATH')) { exit; }

/** Configure webhook target + secret */
if (!defined('EXAMPLE_WEBHOOK_URL')) {
  // If using Local, you can also try http://host.docker.internal:3000/webhooks/wp
  define('EXAMPLE_WEBHOOK_URL', 'http://192.168.1.136:3000/webhooks/wp');
}
if (!defined('EXAMPLE_WEBHOOK_SECRET')) {
  define('EXAMPLE_WEBHOOK_SECRET', 'devsecret123'); // must match server/.env
}

/** 1) Event post type + REST-visible meta */
add_action('init', function () {
  register_post_type('event', [
    'labels' => ['name' => 'Events', 'singular_name' => 'Event'],
    'public' => true,
    'show_in_rest' => true,
    'menu_icon' => 'dashicons-calendar-alt',
    'supports' => ['title','editor','excerpt','thumbnail'],
  ]);

  register_post_meta('event','start',[
    'type'=>'string','single'=>true,'show_in_rest'=>true,'sanitize_callback'=>'sanitize_text_field'
  ]);
  register_post_meta('event','venue',[
    'type'=>'string','single'=>true,'show_in_rest'=>true,'sanitize_callback'=>'sanitize_text_field'
  ]);
  register_post_meta('event','ticket_url',[
    'type'=>'string','single'=>true,'show_in_rest'=>true,'sanitize_callback'=>'esc_url_raw'
  ]);
});

/** 2) Meta box (lets editors enter start/venue/ticket_url) */
add_action('add_meta_boxes', function () {
  add_meta_box('event_meta','Event details', function($post){
    $start=get_post_meta($post->ID,'start',true);
    $venue=get_post_meta($post->ID,'venue',true);
    $turl =get_post_meta($post->ID,'ticket_url',true);
    wp_nonce_field('event_meta_save','event_meta_nonce'); ?>
    <p><label><strong>Start (ISO 8601)</strong><br/>
      <input type="text" name="event_start" value="<?php echo esc_attr($start); ?>" style="width:100%" placeholder="2025-09-01T19:30:00Z">
    </label></p>
    <p><label><strong>Venue</strong><br/>
      <input type="text" name="event_venue" value="<?php echo esc_attr($venue); ?>" style="width:100%">
    </label></p>
    <p><label><strong>Ticket URL</strong><br/>
      <input type="url" name="event_ticket_url" value="<?php echo esc_attr($turl); ?>" style="width:100%" placeholder="https://tickets.example.com/xyz">
    </label></p>
  <?php }, 'event','side','default');
});

/** 3) Save meta (no webhook here) */
add_action('save_post_event', function($post_id, $post, $update){
  // Skip autosaves/revisions
  if (wp_is_post_autosave($post_id) || wp_is_post_revision($post_id)) return;
  if ($post->post_type !== 'event') return;
  if (!current_user_can('edit_post', $post_id)) return;

  // Only process when coming from the meta box (classic/quick edit)
  if (isset($_POST['event_meta_nonce']) && wp_verify_nonce($_POST['event_meta_nonce'], 'event_meta_save')) {
    $start = isset($_POST['event_start']) ? sanitize_text_field($_POST['event_start']) : '';
    if ($start && !preg_match('/\d{4}-\d{2}-\d{2}T/', $start)) {
      $ts = strtotime($start);
      if ($ts) $start = gmdate('c', $ts);
    }
    $venue = isset($_POST['event_venue']) ? sanitize_text_field($_POST['event_venue']) : '';
    $turl  = isset($_POST['event_ticket_url']) ? esc_url_raw($_POST['event_ticket_url']) : '';

    update_post_meta($post_id,'start',$start);
    update_post_meta($post_id,'venue',$venue);
    update_post_meta($post_id,'ticket_url',$turl);
  }
}, 10, 3);

/** Utility: build final payload from DB */
function example_events_build_payload($post_id, $action = 'updated', $source = 'wp_after_insert_post') {
  $post = get_post($post_id);
  if (!$post || $post->post_type !== 'event') return null;

  $title = get_the_title($post_id);
  $start = get_post_meta($post_id, 'start', true);
  $venue = get_post_meta($post_id, 'venue', true);
  $turl  = get_post_meta($post_id, 'ticket_url', true);
  $mod   = $post->post_modified_gmt ?: $post->post_date_gmt;
  $status = $post->post_status;

  $fingerprint = md5(implode('|', [
    (int)$post_id, (string)$title, (string)$start, (string)$venue, (string)$turl, (string)$mod, (string)$status
  ]));

  return [
    'id'           => (int)$post_id,
    'title'        => (string)$title,
    'start'        => (string)$start,
    'venue'        => (string)$venue,
    'url'          => (string)$turl,
    'status'       => (string)$status,
    'modified_gmt' => (string)$mod,
    'action'       => (string)$action,
    'source'       => (string)$source,
    'fingerprint'  => $fingerprint,
  ];
}

/** Utility: send webhook once per fingerprint (2s lock) */
function example_events_send_once($payload) {
  if (!$payload) return;
  $lock_key = 'example_webhook_' . $payload['fingerprint'];
  if (get_transient($lock_key)) return;              // recently sent; skip
  set_transient($lock_key, 1, 2);                    // small burst window

  $args = [
    'timeout'  => 5,
    'blocking' => true, // log success/failure
    'headers'  => [
      'Content-Type'     => 'application/json',
      'X-Webhook-Secret' => EXAMPLE_WEBHOOK_SECRET
    ],
    'body' => wp_json_encode($payload),
  ];

  error_log("[Example Events] webhook → {$payload['source']} id={$payload['id']} action={$payload['action']} fp={$payload['fingerprint']}");
  $resp = wp_remote_post(EXAMPLE_WEBHOOK_URL, $args);

  if (is_wp_error($resp)) {
    error_log('[Example Events] webhook ERROR: ' . $resp->get_error_message());
    return;
  }
  $code = wp_remote_retrieve_response_code($resp);
  $body = wp_remote_retrieve_body($resp);
  error_log("[Example Events] webhook OK code={$code} body={$body}");
}

/**
 * 4) Fire ONE webhook after post + meta are saved (covers classic, quick edit, Gutenberg, REST).
 *    This runs after DB commit, so payload has final values.
 */
add_action('wp_after_insert_post', function($post_id, $post, $update, $post_before){
  if ($post->post_type !== 'event') return;
  // Skip autosaves/revisions/special contexts
  if (wp_is_post_autosave($post_id) || wp_is_post_revision($post_id)) return;

  $action = $update ? 'updated' : 'created';
  // If newly published, you can choose to label it 'published'
  if (!$update && $post->post_status === 'publish') $action = 'published';

  $payload = example_events_build_payload($post_id, $action, 'wp_after_insert_post');
  example_events_send_once($payload);
}, 20, 4);

/** 5) Public REST endpoint for apps */
add_action('rest_api_init', function () {
  register_rest_route('example/v1','/events',[
    'methods'=>'GET','permission_callback'=>'__return_true',
    'callback'=>function(\WP_REST_Request $req){
      $q = new WP_Query([
        'post_type'=>'event','post_status'=>'publish',
        'posts_per_page'=>50,'orderby'=>'meta_value','meta_key'=>'start','order'=>'ASC',
      ]);
      $out = [];
      while ($q->have_posts()){ $q->the_post(); $id=get_the_ID();
        $out[] = [
          'id'=>$id,'title'=>get_the_title(),
          'start'=>get_post_meta($id,'start',true),
          'venue'=>get_post_meta($id,'venue',true),
          'url'=>get_post_meta($id,'ticket_url',true),
        ];
      }
      wp_reset_postdata();
      return rest_ensure_response($out);
    }
  ]);
});
