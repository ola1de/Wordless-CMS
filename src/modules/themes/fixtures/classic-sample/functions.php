<?php
function classic_sample_setup() {
	add_theme_support( 'title-tag' );
	register_nav_menu( 'primary', 'Primary Menu' );
}
add_action( 'after_setup_theme', 'classic_sample_setup' );

function classic_sample_assets() {
	wp_enqueue_style( 'classic-sample-style', get_stylesheet_uri() );
}
add_action( 'wp_enqueue_scripts', 'classic_sample_assets' );
