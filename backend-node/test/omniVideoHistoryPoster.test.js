const test = require('node:test');
const assert = require('node:assert/strict');
const { list } = require('../src/services/omniVideoService');

test('omni history list selects and returns the completed video poster path', () => {
  let sql = '';
  let params = [];
  const db = {
    prepare(statement) {
      sql = statement;
      return {
        all(...values) {
          params = values;
          return [{
            id: 26,
            video_generation_id: 26,
            status: 'completed',
            local_path: 'projects/demo/videos/vg_26.mp4',
            poster_local_path: 'projects/demo/videos/posters/vg_26.jpg',
            storyboard_local_path: 'projects/demo/videos/vg_26.mp4',
            active_video_generation_id: 26,
            video_url: null,
          }];
        },
      };
    },
  };

  const rows = list(db, { storyboard_id: 88 });

  assert.match(sql, /v\.poster_local_path/);
  assert.deepEqual(params, [88, 88]);
  assert.equal(rows[0].poster_local_path, 'projects/demo/videos/posters/vg_26.jpg');
  assert.equal(rows[0].video_url, '/static/projects/demo/videos/vg_26.mp4');
  assert.equal(rows[0].is_current, true);
});
