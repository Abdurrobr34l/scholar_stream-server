const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

//* MIDDLEWARE
app.use(cors());
app.use(express.json());

const uri = process.env.MONGO_DB_URI;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    //* Server(Backened) Connected to DB Console
    console.log("Connected to MongoDB");

    //* ALL DB COLLECTIONS
    const usersCollection = client.db("scholar_streame-DB").collection("users");
    const allScholarshipCollection = client.db("scholar_streame-DB").collection("scholarships");

    //* Testing Route
    app.get("/", (req, res) => res.send("Server is running!"));

    //* Sending Register User Details to DB (POST) (USER INFO)
    app.post("/users", async (req, res) => {
      const user = req.body;
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) return res.send({ message: "User Exists" });
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    //* Get All Scholarship Data (GET)
    app.get("/scholarships", async (req, res) => {
      try {
        const scholarship = (await allScholarshipCollection.find({}).sort({ applicationFees: 1 }).toArray()); //*Sorting by fee
        // const scholarship = (await allScholarshipCollection.find({}).sort({ createdAt: -1 }).toArray()); //*Sorting by created at time
        res.send(scholarship)
      }
      catch (error) {
        res.status(500).send({ message: "Failed to fetch scholarships data's" });
      }
    });

    //* Get Scholarship Data By ID (GET)
    app.get("/scholarships/:id", async (req, res) => {
      try {
        const id = req.params.id;
        const scholarship = await allScholarshipCollection.findOne({ _id: new ObjectId(id) });
        if (!scholarship) return res.status(404).send({ message: "Scholarship not found" });
        // res.send({ ...scholarship, reviews });
        res.send(scholarship);
      }
      catch (error) {
        res.status(500).send({ message: "Failed to fetch scholarship details" });
      }
    });

    //* Server Runnning MSG Console
    app.listen(port, () => console.log(`Server is running on port ${port}`));
  } catch (err) {
    console.error(err);
  }
}

run();
