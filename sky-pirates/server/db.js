function initializeDatabase(callback) {
    db = mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
  
    db.connect((err) => {
      if (err) {
        console.error('Database connection failed during initialization:', err);
        return callback(false);
      }
  
      db.query(`CREATE DATABASE IF NOT EXISTS ${process.env.DB_NAME}`, (err) => {
        if (err) {
          console.error('Error creating database:', err);
          db.end();
          return callback(false);
        }
  
        console.log(`Database ${process.env.DB_NAME} initialized successfully.`);
        return callback(true);
      });
    });
  }
  
  function createTables(callback) {
    db.connect((err) => {
      if (err) {
        console.error('Database connection failed during initialization:', err);
        return callback(false); 
      }
  
      db.query('DROP TABLE players');
  
      db.query(`CREATE TABLE players
        ( username varchar(100) NOT NULL,
        password varchar(100) NOT NULL,
        PRIMARY KEY (username)
        )`, (err) => {
        if (err) {
          console.error('Error creating players table:', err);
          return callback(false);
        }
  
        console.log(`Table players created successfully.`);
        return callback(true);
      });
    });
  }
  
  app.post('/initDB', (req, res) => {
    initializeDatabase((dbstatus) => {
      if (dbstatus) {
        createTables((tstatus) => {
          if (tstatus) {
            res.json({ status: true, message: 'Database connection successful.' });
            dbInit = true;
          }
          else {
            res.json({ status: false, message: 'Failed to initialize the players table.' });
          }
        });
      } else {
        res.json({ status: false, message: 'Failed to initialize the database.' });
        dbInit = false;
      }
    });
  });