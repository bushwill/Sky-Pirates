let x = 400;
let y = 100;
let v_x = 0;
let v_y = 0;
let target_x = 400;
let target_y = 150;

let in_water = false;
let swimming = false;
let flying_mode = true;
let flying = true;

let teleport = false;
let tp_cooldown = 100;
let guide_mode = false;

let water_particles = {};
let flame_particles = {};
let general_particles = {};

let fuel_pickups = {};
let ability_pickups = {};

let enemy_list = {};
let enemy_coord_list = [];

let health = 100;
let fuel = 100;
let speed = 0;
let game_start = 0;

let wave = 0;
let wave_time = 0;
let wave_spawn = false;

let dead = false;
let death_message = "";

function restartGame() {
  x = 400;
  y = 100;
  v_x = 0;
  v_y = 0;
  target_x = 400;
  target_y = 150;
  teleport = false;
  fuel_pickups = {};
  ability_pickups = {};
  enemy_list = {};
  enemy_coord_list = [];
  health = 100;
  fuel = 100;
  speed = 0;
  game_start = millis();
  wave = 0;
  dead = false;
}

function setup() {
  createCanvas(windowWidth, windowHeight);
  textSize(16);
  restartGame();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {
  if (dead) {
    // Delay handled differently in p5.js
    if (millis() > game_start + 5000) {
      restartGame();
    }
  }

  // Draw sky and ocean
  rectMode(CORNER);
  stroke(0);
  strokeWeight(1);
  background(110, 155, 255);
  fill(50, 70, 255);
  rect(0, height * 0.75, width, height * 0.25); // Water at 75% of screen height

  // Boundaries
  if (x > width) {
    v_x = 0;
    x = width;
  } else if (x < 0) {
    v_x = 0;
    x = 0;
  }
  if (y > height) {
    v_y = 0;
    y = height;
  } else if (y < 0) {
    v_y = 0;
    y = 0;
  }

  // Update position based on velocity
  x += v_x;
  y += v_y;

  // Gravity
  if (!(in_water || flying)) {
    swimming = false;
    if (v_y < 10) {
      v_y += 0.2;
    }
  }

  // Water drag
  if (in_water) {
    v_x -= v_x / 8;
    v_y -= v_y / 8;
  }

  // Air drag
  if (!in_water) {
    v_x = v_x * 0.98;
    v_y += 0.05;
  }

  // Swim towards target
  if (in_water && swimming) {
    // Keeps swim speed consistent
    let x_dif = Math.abs(target_x - x);
    let y_dif = Math.abs(target_y - y);
    let x_speed = x_dif / (x_dif + y_dif) || 0;  // Prevent division by zero
    let y_speed = y_dif / (x_dif + y_dif) || 0;  // Prevent division by zero

    // Towards target_x
    // Stops near target
    if (Math.abs(target_x - x) < 1) {
      v_x = v_x * 0.8;
    }
    // Accelerates towards target
    else if (target_x > x) {
      if (v_x < 2 * (x_speed)) {
        v_x += 0.2;
      }
    } else if (target_x < x) {
      if (v_x > -2 * (x_speed)) {
        v_x -= 0.2;
      }
    }

    // Towards target_y
    // Stops near target
    if (Math.abs(target_y - y) < 1) {
      v_y = v_y * 0.8;
    }
    // Accelerates towards target
    else if (target_y > y) {
      if (v_y < 2 * (y_speed)) {
        v_y += 0.2;
      }
    } else if (target_y < y) {
      if (v_y > -3 * (y_speed)) {
        v_y -= 0.3;
      }
    }
  }

  // Fly towards target
  if (flying) {
    // Keeps fly speed consistent
    let x_dif = Math.abs(target_x - x);
    let y_dif = Math.abs(target_y - y);
    let x_speed = x_dif / (x_dif + y_dif) || 0;  // Prevent division by zero
    let y_speed = y_dif / (x_dif + y_dif) || 0;  // Prevent division by zero

    // Towards target_x
    // Stops near target
    if (Math.abs(target_x - x) < 3) {
      v_x = v_x * 0.5;
    }
    // Accelerates from far away
    else if (target_x > x) {
      if (v_x < 8 * (x_speed)) {
        v_x += 0.2;
      }
    } else if (target_x < x) {
      if (v_x > -8 * (x_speed)) {
        v_x -= 0.2;
      }
    }

    // Towards target_y
    // Stops near target
    if (Math.abs(target_y - y) < 5) {
      v_y = v_y * 0.5;
    }
    // Accelerates from far away
    else if (target_y > y) {
      if (v_y < 15 * (y_speed)) {
        v_y += 0.2;
      }
    } else if (target_y < y) {
      if (v_y > -7 * (y_speed)) {
        v_y -= 0.2;
      }
    }
  }

  // Create water particles
  if (in_water && (Math.abs(v_x) >= 0.9 || Math.abs(v_y) >= 0.9)) {
    speed = Math.abs(v_x) + Math.abs(v_y);
    for (let i = 0; i < int(speed); i++) {
      let r_x = floor(random(x - speed, x + speed));
      let r_y = floor(random(y - speed, y + speed));
      water_particles[`${r_x},${r_y}`] = 10;
    }
  }

  // Display water particles
  fill(80, 110, 255);
  Object.keys(water_particles).forEach(key => {
    let coords = key.split(',');
    let particle_x = parseInt(coords[0]);
    let particle_y = parseInt(coords[1]);
    let size = water_particles[key];

    circle(particle_x, particle_y, size);

    // Update each water_particle
    if (size <= 0) {
      delete water_particles[key];
    } else if (size <= 10) {
      water_particles[key] = size - 0.5;
    } else {
      water_particles[key] = 10;
    }
  });

  // Create flame particles
  if (flying) {
    speed = Math.abs(v_x) + Math.abs(v_y);

    // Add to flame_particle list when hovering
    if (speed < 2) {
      let r_x = floor(random(x - 3, x + 3));
      let r_y = floor(random(y, y + 10));
      flame_particles[`${r_x},${r_y}`] = 10;
    }

    // Add to flame_particle list when moving
    for (let i = 0; i < int(speed); i++) {
      let r_x = floor(random(x - speed, x + speed));
      let r_y = floor(random(y - speed, y + speed));
      flame_particles[`${r_x},${r_y}`] = 10;
    }
  }

  // Display flame particles
  Object.keys(flame_particles).forEach(key => {
    let coords = key.split(',');
    let particle_x = parseInt(coords[0]);
    let particle_y = parseInt(coords[1]);
    let size = flame_particles[key];

    fill(255, fuel * 2, 0);
    circle(particle_x, particle_y, size);

    // Flame reflection (adjusted for dynamic water level)
    const waterLevel = height * 0.75;
    fill(175, fuel * 1.5, 50);
    if (particle_y < waterLevel) {
      circle(particle_x, 2 * waterLevel - particle_y, size);
    }

    // Update each flame_particle
    if (size <= 0) {
      delete flame_particles[key];
    } else if (size <= 10) {
      flame_particles[key] = size - 0.5;
    } else {
      flame_particles[key] = 10;
    }
  });

  // Display moving pieces
  rectMode(CENTER);

  // Display game elements
  updateStatus();
  updateBurst();
  updateWave();
  updateEnemies();
  displayStatus();

  if (!dead) {
    pickups();
    updateTarget();
    displayScoreboard();
    displayCharacter();
  }
}

function displayCharacter() {
  stroke(0);
  strokeWeight(1);

  const waterLevel = height * 0.75;

  // Display character reflection
  if (y < waterLevel) {
    fill(75, 160, 150);
    square(x, 2 * waterLevel - y, 10);
  }

  // Display character
  fill(0, 255, 0);
  square(x, y, 10);
}

function createBurst(r, g, b, n, burst_x, burst_y) {
  for (let p = 0; p < n + 1; p++) {
    let r_x = floor(random(burst_x - 20, burst_x + 20));
    let r_y = floor(random(burst_y - 20, burst_y + 20));
    general_particles[`${r_x},${r_y}`] = { r: r, g: g, b: b, s: 5 };
  }
}

function updateBurst() {
  stroke(0);
  strokeWeight(1);

  Object.keys(general_particles).forEach(key => {
    let coords = key.split(',');
    let pk_x = parseInt(coords[0]);
    let pk_y = parseInt(coords[1]);
    let pv = general_particles[key];

    if (pv.s <= 0) {
      delete general_particles[key];
    } else {
      fill(pv.r, pv.g, pv.b);
      circle(pk_x, pk_y, pv.s);
      pv.s -= 0.5;
    }
  });
}

function updateTarget() {
  target_x = mouseX;
  target_y = mouseY;

  // Display target
  stroke(0);
  strokeWeight(1);
  if (!dead) {
    fill(255);
    square(target_x, target_y, 10);
  }

  // Display guide line
  if (guide_mode) {
    stroke(255);
    strokeWeight(2);
    line(x, y, target_x, target_y);
  }
}

function takeDamage(dmg, message) {
  if (health < dmg) {
    createBurst(0, 255, 0, 10, x, y);
    death_message = message;
    health -= dmg;
  } else {
    health -= dmg;
  }

  createBurst(255, 30, 30, 20, x, y);
  createBurst(200, 10, 10, 20, x, y);
  createBurst(100, 0, 0, 10, x, y);
}

function updateStatus() {
  // Update speed
  speed = Math.abs(v_x) + Math.abs(v_y);

  // Update fuel
  if (flying) {
    fuel -= ((Math.abs(v_x) / 100) + 0.05) - (v_y / 100);
  }
  // Regenerates fuel in water
  else if (in_water && fuel < 100) {
    fuel += 0.01 * wave;
  }

  if (fuel > 100) {
    fuel = 100;
  } else if (fuel < 0) {
    fuel = 0;
  }

  // Regenerate health
  if (!dead) {
    health += 0.2;
    if (health > 100) {
      health = 100;
    } else if (health < 0) {
      health = 0;
    }
  }

  // Check if dead
  if (health <= 0) {
    background(0);
    fill(255);
    text("You were killed by " + death_message, width / 4, height / 2);
    text("You survived until wave " + wave + ".", width / 3, height / 2 + 50);
    dead = true;
  }

  // Recharge teleport
  if (teleport && tp_cooldown <= 99.95) {
    tp_cooldown += 0.5;
  }
  if (tp_cooldown < 0) {
    tp_cooldown = 0;
  }

  // Update in_water
  const waterLevel = height * 0.75;
  in_water = y >= waterLevel;

  // Update swimming
  swimming = Math.abs(v_x) < 2 && Math.abs(v_y) < 2 && in_water;

  // Update flying
  if (flying_mode && fuel > 0) {
    flying = !(in_water || swimming);
  } else {
    flying = false;
  }
}

function displayStatus() {
  noFill();
  strokeWeight(2);
  stroke(255, fuel * 2, 0);
  arc(target_x, target_y, 100, 100, 0, PI * (fuel / 100));
  stroke(200 - health * 2, health * 2, 50);
  arc(target_x, target_y, 100, 100, PI, PI + PI * (health / 100));
  stroke(50, 50, 255);
  arc(target_x, target_y, 90, 90, PI, PI + PI * (speed / 10));

  if (teleport && tp_cooldown == 100) {
    stroke(255, 0, 200);
    arc(target_x, target_y, 110, 110, 0, PI * (tp_cooldown / 100));
  }
  if (teleport && tp_cooldown < 100) {
    stroke(200, 100, 175);
    arc(target_x, target_y, 110, 110, 0, PI * (tp_cooldown / 100));
  }
}

function displayScoreboard() {
  fill(0);
  text("Wave: " + wave, 10, 15);
  if (wave_spawn) {
    text("Enemies remaining: " + Object.keys(enemy_list).length, 10, 30);
  } else {
    text("Wave starts in " + Math.floor((wave_time - 1000 - millis()) / 1000) + "s", 10, 30);
  }
}

function pickups() {
  stroke(0);
  strokeWeight(1);

  // Time elapsed
  let te = millis() - game_start;
  const waterLevel = height * 0.75;

  // Add fuel pickup if fuel is empty
  if (fuel <= 0) {
    if (Object.keys(fuel_pickups).length === 0) {
      let r_x = floor(random(20, width - 20));
      let r_y = floor(random(waterLevel, height - 20));
      fuel_pickups[`${r_x},${r_y}`] = 50;
    }
  }

  // Display all fuel pickups
  Object.keys(fuel_pickups).forEach(key => {
    let coords = key.split(',');
    let item_x = parseInt(coords[0]);
    let item_y = parseInt(coords[1]);

    fill(255, 200, 0);
    rect(item_x, item_y, 20, 40);
    createBurst(255, 200, 0, 10, item_x, item_y);

    if (item_y < waterLevel) {
      fill(150, 160, 30);
      rect(item_x, 2 * waterLevel - item_y, 20, 40);
    }

    // If character picks up a fuel pickup
    if (Math.abs(x - item_x) < 10 && Math.abs(y - item_y) < 20) {
      fuel += fuel_pickups[key];
      delete fuel_pickups[key];
    }
  });

  // Display all ability pickups
  Object.keys(ability_pickups).forEach(key => {
    let coords = key.split(',');
    let item_x = parseInt(coords[0]);
    let item_y = parseInt(coords[1]);
    let type = ability_pickups[key];

    if (type == 1) {
      fill(175, 50, 160);
      circle(item_x, item_y, 30);
      createBurst(175, 50, 160, 5, item_x, item_y);

      if (item_y < waterLevel) {
        fill(140, 20, 150);
        circle(item_x, 2 * waterLevel - item_y, 30);
      }

      if (Math.abs(x - item_x) < 15 && Math.abs(y - item_y) < 15) {
        teleport = true;
        tp_cooldown = 100;
        delete ability_pickups[key];
      }
    }
  });
}

function createAbilityPickup(type) {
  let r_x = floor(random(width * 0.25, width * 0.75));
  let r_y = floor(random(height * 0.125, height * 0.625));
  ability_pickups[`${r_x},${r_y}`] = type;
}

function updateWave() {
  // Wave completed
  if (Object.keys(enemy_list).length === 0 && wave_time < millis()) {
    wave += 1;
    wave_time = millis() + 5000;
    wave_spawn = false;
    if (!teleport && wave > 1) {
      let chance = floor(random(1, 6));
      if (chance == 5) {
        createAbilityPickup(1);
      }
    }
  }

  // Start spawns
  if (wave_time - millis() < 1000) {
    wave_spawn = true;
  }

  // Reset vitals
  if (wave_spawn == false) {
    fuel = 100;
    health = 100;
  }

  // Wave spawn behavior
  while (Object.keys(enemy_list).length < wave * 2 && millis() < wave_time && wave_spawn) {
    let type;
    if (wave < 5) {
      type = floor(random(1, 3));
    } else if (wave >= 5 && wave < 10) {
      type = floor(random(1, 4));
    } else if (wave >= 10) {
      type = 3;
    }
    createEnemy(type);
  }
}

function createEnemy(enemy_type) {
  let x_spawn_point, y_spawn_point, spawn_side;

  if (enemy_type == 1 || enemy_type == 2) {
    x_spawn_point = floor(random(0, width));
    y_spawn_point = floor(random(0, height * 0.75));
    spawn_side = floor(random(1, 4));
  } else if (enemy_type == 3) {
    x_spawn_point = floor(random(0, width));
    y_spawn_point = height;
    spawn_side = 4;
  }

  const unique_id = millis() + "_" + Math.random();

  if (spawn_side == 1) {
    enemy_list[unique_id] = { x: -10, y: y_spawn_point, type: enemy_type };
  } else if (spawn_side == 2) {
    enemy_list[unique_id] = { x: width + 10, y: y_spawn_point, type: enemy_type };
  } else if (spawn_side == 3) {
    enemy_list[unique_id] = { x: x_spawn_point, y: -10, type: enemy_type };
  } else if (spawn_side == 4) {
    enemy_list[unique_id] = { x: x_spawn_point, y: height + 10, type: enemy_type };
  }
}

function updateEnemies() {
  // Refresh enemy_coord_list
  enemy_coord_list = [];
  const waterLevel = height * 0.75;

  // Display enemies
  Object.keys(enemy_list).forEach(enemy_number => {
    let enemy = enemy_list[enemy_number];
    let e_x = enemy.x;
    let e_y = enemy.y;
    let e_t = enemy.type;

    // Eye
    if (e_t == 1) {
      fill(255, 0, 0);
      circle(e_x, e_y, 20);
      fill(255);
      circle(e_x, e_y, 14);
      fill(0);
      circle(e_x, e_y, 6);

      if (e_y < waterLevel) {
        fill(170, 20, 90);
        circle(e_x, 2 * waterLevel - e_y, 20);
        fill(190, 160, 225);
        circle(e_x, 2 * waterLevel - e_y, 14);
        fill(30, 25, 40);
        circle(e_x, 2 * waterLevel - e_y, 6);
      }
    }
    // Bee
    else if (e_t == 2) {
      fill(255, 255, 10);
      circle(e_x, e_y, 15);
      stroke(155);
      rect(e_x, e_y - 5, 10, 1);
      stroke(0);
      fill(0);
      rect(e_x, e_y - 3, 13, 1);
      circle(e_x, e_y + 3, 4);

      if (e_y < waterLevel) {
        fill(130, 160, 40);
        circle(e_x, 2 * waterLevel - e_y, 15);
        rect(e_x, 2 * waterLevel - e_y + 3, 13, 1);
        fill(5, 5, 10);
        circle(e_x, 2 * waterLevel - e_y - 3, 4);
      }
    }
    // Sea monster
    else if (e_t == 3) {
      fill(100, 100, 200);
      let x1 = floor(random(e_x - 20, e_x + 20));
      let y1 = floor(random(e_y - 20, e_y + 20));
      let x2 = floor(random(e_x - 20, e_x + 20));
      let y2 = floor(random(e_y - 20, e_y + 20));
      let x3 = floor(random(e_x - 20, e_x + 20));
      let y3 = floor(random(e_y - 20, e_y + 20));
      triangle(x1, y1, x2, y2, x3, y3);
      createBurst(100, 100, 100, 5, e_x, e_y);

      if (e_y < waterLevel) {
        fill(130, 160, 40);
        triangle(x1, 2 * waterLevel - y1, x2, 2 * waterLevel - y2, x3, 2 * waterLevel - y3);
      }
    }

    let cp = { x: -50, y: -50 };
    if (enemy_coord_list.length > 0) {
      const closestIdx = closestPoint(e_x, e_y, enemy_coord_list);
      cp = { x: enemy_coord_list[closestIdx][0], y: enemy_coord_list[closestIdx][1] };
    }

    // Enemies movement
    if (e_t == 1) {
      let x_dif = Math.abs(e_x - x);
      let y_dif = Math.abs(e_y - y);
      let x_speed = x_dif / (x_dif + y_dif) || 0;  // Prevent division by zero
      let y_speed = y_dif / (x_dif + y_dif) || 0;  // Prevent division by zero
      let move_speed = 2;

      if (e_x < x && Math.abs(cp.x - e_x) > 20) {
        e_x += move_speed * x_speed;
      } else if (e_x > x && Math.abs(cp.x - e_x) > 20) {
        e_x -= move_speed * x_speed;
      }

      if (e_y < y && Math.abs(cp.y - e_y) > 20) {
        e_y += move_speed * y_speed;
      } else if (e_y > y && Math.abs(cp.y - e_y) > 20) {
        e_y -= move_speed * y_speed;
      }
    }
    else if (e_t == 2) {
      let move_speed = floor(random(0, 3));
      let jiggle = floor(random(-1, 2));

      if (e_x < x && Math.abs(cp.x - e_x) > 10) {
        e_x += move_speed;
        e_y += jiggle;
      } else if (e_x > x && Math.abs(cp.x - e_x) > 10) {
        e_x -= move_speed;
        e_y += jiggle;
      }

      if (e_y < y && Math.abs(cp.y - e_y) > 10 && e_y < waterLevel - 40) {
        e_x += jiggle;
        e_y += move_speed;
      } else if (e_y > y && Math.abs(cp.y - e_y) > 10) {
        e_x += jiggle;
        e_y -= move_speed;
      }
    }
    else if (e_t == 3) {
      let x_dif = Math.abs(e_x - x);
      let y_dif = Math.abs(e_y - y);
      let x_speed = x_dif / y_dif || 0;  // Prevent division by zero
      let y_speed = y_dif / x_dif || 0;  // Prevent division by zero

      if (x_speed > 5) x_speed = 5;
      if (y_speed > 5) y_speed = 5;

      let move_speed = 1;

      if (e_x < x) {
        e_x += move_speed * x_speed;
      } else if (e_x > x) {
        e_x -= move_speed * x_speed;
      }

      if (e_y < y) {
        e_y += move_speed * y_speed;
      } else if (e_y > y) {
        e_y -= move_speed * y_speed;
      }
    }

    enemy_list[enemy_number] = { x: e_x, y: e_y, type: e_t };
    enemy_coord_list.push([e_x, e_y]);

    // If character touches an enemy
    speed = Math.abs(v_x) + Math.abs(v_y);

    // Eye
    if (e_t == 1) {
      if (Math.abs(x - e_x) < 10 && Math.abs(y - e_y) < 10) {
        if (speed > 5) {
          delete enemy_list[enemy_number];
          createBurst(255, 50, 20, 10, e_x, e_y);
          createBurst(255, 255, 255, 5, e_x, e_y);
          createBurst(0, 0, 0, 5, e_x, e_y);

          let col_strength = 2.5;
          if (v_x > 0) {
            v_x -= col_strength;
          } else if (v_x < 0) {
            v_x += col_strength;
          }
          if (v_y > 0) {
            v_y -= col_strength;
          } else if (v_y < 0) {
            v_y += col_strength;
          }
        } else {
          takeDamage(40, "Eye");
          delete enemy_list[enemy_number];
        }
      }
    }
    // Bee
    else if (e_t == 2) {
      if (Math.abs(x - e_x) < 7.5 && Math.abs(y - e_y) < 7.5) {
        if (speed > 2) {
          delete enemy_list[enemy_number];
          createBurst(255, 255, 0, 15, e_x, e_y);

          let col_strength = 1;
          if (v_x > 0) {
            v_x -= col_strength;
          } else if (v_x < 0) {
            v_x += col_strength;
          }
          if (v_y > 0) {
            v_y -= col_strength;
          } else if (v_y < 0) {
            v_y += col_strength;
          }

          takeDamage(10, "Bee");
        } else {
          takeDamage(20, "Bee");
          delete enemy_list[enemy_number];
        }
      }
    }
    // Sea monster
    else if (e_t == 3) {
      if (Math.abs(x - e_x) < 20 && Math.abs(y - e_y) < 20) {
        if (speed > 5) {
          delete enemy_list[enemy_number];
          createBurst(0, 0, 255, 15, e_x, e_y);
          createBurst(255, 0, 0, 30, e_x, e_y);

          let col_strength = 2.5;
          if (v_x > 0) {
            v_x -= col_strength;
          } else if (v_x < 0) {
            v_x += col_strength;
          }
          if (v_y > 0) {
            v_y -= col_strength;
          } else if (v_y < 0) {
            v_y += col_strength;
          }
        } else {
          takeDamage(60, "Some Terrible Thing");
          createEnemy(3);
          delete enemy_list[enemy_number];
        }
      }
    }
  });
}

function closestPoint(x, y, list) {
  let distances = [];
  for (let i = 0; i < list.length; i++) {
    distances.push(Math.abs(list[i][0] - x) + Math.abs(list[i][1] - y));
  }
  return distances.indexOf(Math.min(...distances));
}

function keyPressed() {
  if (key === ' ') {
    flying_mode = !flying_mode;
  }
  if (key === 't' && teleport && tp_cooldown === 100) {
    createBurst(255, 30, 30, 20, x, y);
    createBurst(200, 10, 10, 20, x, y);
    createBurst(100, 0, 0, 10, x, y);
    createBurst(0, 255, 0, 10, x, y);
    x = mouseX;
    y = mouseY;
    createBurst(255, 0, 200, 50, x, y);
    tp_cooldown = 0;
  }
  if (key === 'g') {
    guide_mode = !guide_mode;
  }
}

function mousePressed() {
  if (mouseButton === LEFT) {
    if (fuel >= 10) {
      let x_dif = Math.abs(mouseX - x);
      let y_dif = Math.abs(mouseY - y);
      let x_speed = x_dif / (x_dif + y_dif) || 0;  // Prevent division by zero
      let y_speed = y_dif / (y_dif + x_dif) || 0;  // Prevent division by zero
      let dash_speed = 20;

      if (mouseX < x) {
        v_x = -(dash_speed * x_speed);
      } else if (mouseX > x) {
        v_x = dash_speed * x_speed;
      }

      if (mouseY < y) {
        v_y = -(dash_speed * y_speed);
      } else if (mouseY > y) {
        v_y = dash_speed * y_speed;
      }

      fuel -= 10;
      createBurst(255, 200, 0, 50, x, y);
      createBurst(255, 255, 255, 50, mouseX, mouseY);
    }
  }

  if (mouseButton === RIGHT) {
    if (guide_mode && fuel >= 10) {
      let cp = { x: mouseX, y: mouseY };

      if (enemy_coord_list.length !== 0) {
        const closestIdx = closestPoint(x, y, enemy_coord_list);
        cp = { x: enemy_coord_list[closestIdx][0], y: enemy_coord_list[closestIdx][1] };
      }

      let x_dif = Math.abs(cp.x - x);
      let y_dif = Math.abs(cp.y - y);
      let x_speed = x_dif / (x_dif + y_dif) || 0;  // Prevent division by zero
      let y_speed = y_dif / (y_dif + x_dif) || 0;  // Prevent division by zero
      let dash_speed = 20;

      if (cp.x < x) {
        v_x = -(dash_speed * x_speed);
      } else if (cp.x > x) {
        v_x = dash_speed * x_speed;
      }

      if (cp.y < y) {
        v_y = -(dash_speed * y_speed);
      } else if (cp.y > y) {
        v_y = dash_speed * y_speed;
      }

      fuel -= 10;
      createBurst(255, 200, 0, 50, x, y);
      createBurst(255, 255, 255, 50, mouseX, mouseY);
    }
  }
}