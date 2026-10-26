// Root entry point for Vercel Serverless Function & Local Development
const app = require('./server/server');

if (!process.env.VERCEL && require.main === module) {
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` 🛡️ Mail Track Server Active`);
    console.log(` 🌐 Dashboard: http://localhost:${PORT}`);
    console.log(`=================================================`);
  });
}

module.exports = app;
