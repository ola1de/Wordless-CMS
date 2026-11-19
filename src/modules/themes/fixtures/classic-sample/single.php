<?php
get_header();
the_post();
the_title( '<h1>', '</h1>' );
the_content();
comments_template();
get_footer();
