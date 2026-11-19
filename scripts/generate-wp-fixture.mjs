#!/usr/bin/env node
/**
 * Generate the synthetic WordPress fixture used by the Milestone 9
 * importer tests (test/fixtures/wordpress/).
 *
 * The fixture is SYNTHETIC — written by hand from the WordPress 7.1.5
 * table shapes in the local reference copy
 * (~/workspace/wordless/reference/wordpress-7.1.5/wp-admin/includes/schema.php,
 * read-only, never modified). It covers posts/pages/terms/comments/users/
 * options with PHP-serialized values, a serialized OBJECT (which the
 * importer must refuse), a revision (which must be skipped), and a
 * non-wp_* table (which must be reported as ignored).
 *
 * Run: node scripts/generate-wp-fixture.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "wordpress");
mkdirSync(dir, { recursive: true });

const wxr = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0"
  xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/"
  xmlns:content="http://purl.org/rss/1.0/modules/content/"
  xmlns:wfw="http://wellformedweb.org/CommentAPI/"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:wp="http://wordpress.org/export/1.2/"
>
<channel>
  <title>Fixture Site</title>
  <link>https://example.test</link>
  <description>A synthetic WordPress export for Wordless importer tests.</description>
  <pubDate>Fri, 16 Jan 2026 10:00:00 +0000</pubDate>
  <language>en-GB</language>
  <wp:wxr_version>1.2</wp:wxr_version>
  <wp:base_site_url>https://example.test</wp:base_site_url>
  <wp:base_blog_url>https://example.test</wp:base_blog_url>
  <wp:author>
    <wp:author_id>1</wp:author_id>
    <wp:author_login>fixture-admin</wp:author_login>
    <wp:author_email>admin@example.test</wp:author_email>
    <wp:author_display_name>Fixture Admin</wp:author_display_name>
    <wp:author_first_name>Fixture</wp:author_first_name>
    <wp:author_last_name>Admin</wp:author_last_name>
  </wp:author>
  <wp:author>
    <wp:author_id>2</wp:author_id>
    <wp:author_login>fixture-jane</wp:author_login>
    <wp:author_email>jane@example.test</wp:author_email>
    <wp:author_display_name>Jane Fixture</wp:author_display_name>
    <wp:author_first_name>Jane</wp:author_first_name>
    <wp:author_last_name>Fixture</wp:author_last_name>
  </wp:author>
  <wp:category>
    <wp:term_id>1</wp:term_id>
    <wp:category_nicename>news</wp:category_nicename>
    <wp:category_parent></wp:category_parent>
    <wp:cat_name><![CDATA[News]]></wp:cat_name>
    <wp:category_description><![CDATA[Fixture news.]]></wp:category_description>
  </wp:category>
  <wp:category>
    <wp:term_id>2</wp:term_id>
    <wp:category_nicename>tutorials</wp:category_nicename>
    <wp:category_parent>news</wp:category_parent>
    <wp:cat_name><![CDATA[Tutorials]]></wp:cat_name>
    <wp:category_description><![CDATA[Fixture tutorials.]]></wp:category_description>
  </wp:category>
  <wp:tag>
    <wp:term_id>3</wp:term_id>
    <wp:tag_slug>wordpress</wp:tag_slug>
    <wp:tag_name><![CDATA[wordpress]]></wp:tag_name>
    <wp:tag_description><![CDATA[]]></wp:tag_description>
  </wp:tag>
  <wp:tag>
    <wp:term_id>4</wp:term_id>
    <wp:tag_slug>migration</wp:tag_slug>
    <wp:tag_name><![CDATA[migration]]></wp:tag_name>
    <wp:tag_description><![CDATA[]]></wp:tag_description>
  </wp:tag>
  <item>
    <title>Hello from WordPress</title>
    <link>https://example.test/hello-from-wordpress/</link>
    <pubDate>Sat, 10 Jan 2026 10:30:00 +0000</pubDate>
    <dc:creator><![CDATA[fixture-admin]]></dc:creator>
    <guid isPermaLink="false">https://example.test/?p=10</guid>
    <description></description>
    <content:encoded><![CDATA[<!-- wp:paragraph --><p>Hello, Wordless. This post came from WordPress.</p><!-- /wp:paragraph -->]]></content:encoded>
    <excerpt:encoded><![CDATA[A fixture post.]]></excerpt:encoded>
    <wp:post_id>10</wp:post_id>
    <wp:post_date><![CDATA[2026-01-10 10:30:00]]></wp:post_date>
    <wp:post_date_gmt><![CDATA[2026-01-10 10:30:00]]></wp:post_date_gmt>
    <wp:post_name>hello-from-wordpress</wp:post_name>
    <wp:post_status><![CDATA[publish]]></wp:post_status>
    <wp:post_type><![CDATA[post]]></wp:post_type>
    <wp:post_parent>0</wp:post_parent>
    <wp:menu_order>0</wp:menu_order>
    <wp:post_password></wp:post_password>
    <wp:is_sticky>0</wp:is_sticky>
    <wp:comment_status><![CDATA[open]]></wp:comment_status>
    <wp:ping_status><![CDATA[open]]></wp:ping_status>
    <category domain="category" nicename="news"><![CDATA[News]]></category>
    <category domain="post_tag" nicename="wordpress"><![CDATA[wordpress]]></category>
    <wp:postmeta>
      <wp:meta_key><![CDATA[_fixture_settings]]></wp:meta_key>
      <wp:meta_value><![CDATA[a:2:{s:5:"color";s:4:"blue";s:4:"size";i:3;}]]></wp:meta_value>
    </wp:postmeta>
    <wp:comment>
      <wp:comment_id>100</wp:comment_id>
      <wp:comment_author><![CDATA[Reader One]]></wp:comment_author>
      <wp:comment_author_email>reader@example.test</wp:comment_author_email>
      <wp:comment_author_url></wp:comment_author_url>
      <wp:comment_author_IP>203.0.113.10</wp:comment_author_IP>
      <wp:comment_date><![CDATA[2026-01-11 09:00:00]]></wp:comment_date>
      <wp:comment_date_gmt><![CDATA[2026-01-11 09:00:00]]></wp:comment_date_gmt>
      <wp:comment_content><![CDATA[It's a fixture, and it works.]]></wp:comment_content>
      <wp:comment_approved><![CDATA[1]]></wp:comment_approved>
      <wp:comment_type><![CDATA[]]></wp:comment_type>
      <wp:comment_parent>0</wp:comment_parent>
      <wp:comment_user_id>0</wp:comment_user_id>
    </wp:comment>
    <wp:comment>
      <wp:comment_id>101</wp:comment_id>
      <wp:comment_author><![CDATA[Reader Two]]></wp:comment_author>
      <wp:comment_author_email>reader2@example.test</wp:comment_author_email>
      <wp:comment_author_url></wp:comment_author_url>
      <wp:comment_author_IP>203.0.113.11</wp:comment_author_IP>
      <wp:comment_date><![CDATA[2026-01-12 09:00:00]]></wp:comment_date>
      <wp:comment_date_gmt><![CDATA[2026-01-12 09:00:00]]></wp:comment_date_gmt>
      <wp:comment_content><![CDATA[Waiting for moderation.]]></wp:comment_content>
      <wp:comment_approved><![CDATA[0]]></wp:comment_approved>
      <wp:comment_type><![CDATA[]]></wp:comment_type>
      <wp:comment_parent>100</wp:comment_parent>
      <wp:comment_user_id>0</wp:comment_user_id>
    </wp:comment>
  </item>
  <item>
    <title>About the Fixture</title>
    <link>https://example.test/about-the-fixture/</link>
    <pubDate>Sun, 11 Jan 2026 10:30:00 +0000</pubDate>
    <dc:creator><![CDATA[fixture-jane]]></dc:creator>
    <guid isPermaLink="false">https://example.test/?p=11</guid>
    <description></description>
    <content:encoded><![CDATA[<!-- wp:paragraph --><p>A fixture page.</p><!-- /wp:paragraph -->]]></content:encoded>
    <excerpt:encoded><![CDATA[]]></excerpt:encoded>
    <wp:post_id>11</wp:post_id>
    <wp:post_date><![CDATA[2026-01-11 10:30:00]]></wp:post_date>
    <wp:post_date_gmt><![CDATA[2026-01-11 10:30:00]]></wp:post_date_gmt>
    <wp:post_name>about-the-fixture</wp:post_name>
    <wp:post_status><![CDATA[publish]]></wp:post_status>
    <wp:post_type><![CDATA[page]]></wp:post_type>
    <wp:post_parent>0</wp:post_parent>
    <wp:menu_order>0</wp:menu_order>
    <wp:post_password></wp:post_password>
    <wp:is_sticky>0</wp:is_sticky>
    <wp:comment_status><![CDATA[closed]]></wp:comment_status>
    <wp:ping_status><![CDATA[closed]]></wp:ping_status>
  </item>
  <item>
    <title>Fixture Image</title>
    <link>https://example.test/wp-content/uploads/2026/01/fixture.png</link>
    <pubDate>Mon, 12 Jan 2026 10:30:00 +0000</pubDate>
    <dc:creator><![CDATA[fixture-admin]]></dc:creator>
    <guid isPermaLink="false">https://example.test/wp-content/uploads/2026/01/fixture.png</guid>
    <description></description>
    <content:encoded><![CDATA[]]></content:encoded>
    <excerpt:encoded><![CDATA[]]></excerpt:encoded>
    <wp:post_id>12</wp:post_id>
    <wp:post_date><![CDATA[2026-01-12 10:30:00]]></wp:post_date>
    <wp:post_date_gmt><![CDATA[2026-01-12 10:30:00]]></wp:post_date_gmt>
    <wp:post_name>fixture-image</wp:post_name>
    <wp:post_status><![CDATA[inherit]]></wp:post_status>
    <wp:post_type><![CDATA[attachment]]></wp:post_type>
    <wp:post_parent>10</wp:post_parent>
    <wp:menu_order>0</wp:menu_order>
    <wp:post_password></wp:post_password>
    <wp:is_sticky>0</wp:is_sticky>
    <wp:comment_status><![CDATA[open]]></wp:comment_status>
    <wp:ping_status><![CDATA[closed]]></wp:ping_status>
    <wp:postmeta>
      <wp:meta_key><![CDATA[_wp_attached_file]]></wp:meta_key>
      <wp:meta_value><![CDATA[2026/01/fixture.png]]></wp:meta_value>
    </wp:postmeta>
  </item>
  <item>
    <title>Hello from WordPress (revision)</title>
    <link>https://example.test/hello-from-wordpress/</link>
    <pubDate>Sat, 10 Jan 2026 11:00:00 +0000</pubDate>
    <dc:creator><![CDATA[fixture-admin]]></dc:creator>
    <guid isPermaLink="false">https://example.test/?p=13</guid>
    <description></description>
    <content:encoded><![CDATA[Old revision content.]]></content:encoded>
    <excerpt:encoded><![CDATA[]]></excerpt:encoded>
    <wp:post_id>13</wp:post_id>
    <wp:post_date><![CDATA[2026-01-10 11:00:00]]></wp:post_date>
    <wp:post_date_gmt><![CDATA[2026-01-10 11:00:00]]></wp:post_date_gmt>
    <wp:post_name>10-revision-v1</wp:post_name>
    <wp:post_status><![CDATA[inherit]]></wp:post_status>
    <wp:post_type><![CDATA[revision]]></wp:post_type>
    <wp:post_parent>10</wp:post_parent>
    <wp:menu_order>0</wp:menu_order>
    <wp:post_password></wp:post_password>
    <wp:is_sticky>0</wp:is_sticky>
    <wp:comment_status><![CDATA[closed]]></wp:comment_status>
    <wp:ping_status><![CDATA[closed]]></wp:ping_status>
  </item>
</channel>
</rss>
`;

const sql = `-- Synthetic WordPress mysqldump for Wordless importer tests (Milestone 9).
-- Hand-written from the WordPress 7.1.5 schema; values are fictional.
-- phpass hashes below are fake (not real password hashes).

INSERT INTO \`wp_users\` VALUES
(1,'fixture-admin','$P$Bfakephpasshashfixtureadmin0000000000000000000','fixture-admin','admin@example.test','','2026-01-01 00:00:00','',0,'Fixture Admin'),
(2,'fixture-jane','$P$Bfakephpasshashfixturejane000000000000000000000','fixture-jane','jane@example.test','','2026-01-02 00:00:00','',0,'Jane Fixture');

INSERT INTO \`wp_usermeta\` VALUES
(1,1,'wp_capabilities','a:1:{s:13:"administrator";b:1;}'),
(2,1,'first_name','Fixture'),
(3,2,'wp_capabilities','a:1:{s:6:"author";b:1;}');

INSERT INTO \`wp_terms\` VALUES
(1,'News','news',0),
(2,'Tutorials','tutorials',0),
(3,'wordpress','wordpress',0),
(4,'migration','migration',0);

INSERT INTO \`wp_term_taxonomy\` VALUES
(1,1,'category','Fixture news.',0,1),
(2,2,'category','Fixture tutorials.',1,0),
(3,3,'post_tag','',0,1),
(4,4,'post_tag','',0,0);

INSERT INTO \`wp_termmeta\` VALUES
(1,1,'fixture_term_note','news term');

INSERT INTO \`wp_posts\` VALUES
(10,1,'2026-01-10 10:30:00','2026-01-10 10:30:00','<!-- wp:paragraph --><p>Hello, Wordless. This post came from WordPress.</p><!-- /wp:paragraph -->','Hello from WordPress','A fixture post.','publish','open','open','','hello-from-wordpress','2026-01-10 10:30:00','2026-01-10 10:30:00','',0,'https://example.test/?p=10',0,'post','',1),
(11,2,'2026-01-11 10:30:00','2026-01-11 10:30:00','<!-- wp:paragraph --><p>A fixture page.</p><!-- /wp:paragraph -->','About the Fixture','','publish','closed','closed','','about-the-fixture','2026-01-11 10:30:00','2026-01-11 10:30:00','',0,'https://example.test/?p=11',0,'page','',0),
(13,1,'2026-01-10 11:00:00','2026-01-10 11:00:00','Old revision content.','Hello from WordPress (revision)','','inherit','closed','closed','','10-revision-v1','2026-01-10 11:00:00','2026-01-10 11:00:00','',10,'https://example.test/?p=13',0,'revision','',0);

INSERT INTO \`wp_postmeta\` VALUES
(1,10,'_fixture_settings','a:2:{s:5:"color";s:4:"blue";s:4:"size";i:3;}'),
(2,10,'_thumbnail_id','12'),
(3,10,'_object_value','O:8:"stdClass":0:{}');

INSERT INTO \`wp_term_relationships\` VALUES
(10,1,0),
(10,3,0);

INSERT INTO \`wp_comments\` VALUES
(100,10,'Reader One','reader@example.test','','203.0.113.10','2026-01-11 09:00:00','2026-01-11 09:00:00','It\\'s a fixture, and it works.',0,'1','','comment',0,0),
(101,10,'Reader Two','reader2@example.test','','203.0.113.11','2026-01-12 09:00:00','2026-01-12 09:00:00','Waiting for moderation.',0,'0','','comment',100,0);

INSERT INTO \`wp_commentmeta\` VALUES
(1,100,'fixture_comment_note','first comment');

INSERT INTO \`wp_links\` VALUES
(1,'https://example.test','Fixture Link','','','A fixture link.','Y',1,0,'2026-01-01 00:00:00','','','');

INSERT INTO \`wp_options\` VALUES
(1,'blogname','Fixture Site','yes'),
(2,'blogdescription','A synthetic WordPress export for Wordless importer tests.','yes'),
(3,'fixture_serialized_option','a:2:{s:5:"color";s:4:"blue";s:4:"size";i:3;}','yes'),
(4,'fixture_object_option','O:8:"stdClass":0:{}','yes');

-- A non-WordPress-core table: the importer must report it as ignored.
INSERT INTO \`wp_custom_plugin\` VALUES (1,'plugin-data');
`;

writeFileSync(join(dir, "wordpress-export.xml"), wxr);
writeFileSync(join(dir, "wordpress-dump.sql"), sql);
console.log(`Wrote fixtures to ${dir}`);
