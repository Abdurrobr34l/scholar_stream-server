const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

dotenv.config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_API);

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

    //todo ---------------------------- ALL DB COLLECTIONS ----------------------------
    const usersCollection = client.db("scholar_streame-DB").collection("users");
    const allScholarshipCollection = client.db("scholar_streame-DB").collection("scholarships");
    const reviewsCollection = client.db("scholar_streame-DB").collection("reviews");
    const applicationsCollection = client.db("scholar_streame-DB").collection("applications");

    //todo ---------------------------- Testing Route ----------------------------
    app.get("/", (req, res) => res.send("Server is running!"));

    //* Sending Register User Details to DB (POST) (USER INFO) (USER)
    app.post("/users", async (req, res) => {
      const user = req.body;
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) return res.send({ message: "User Exists" });
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    //* Get All Users Data (GET) (USER)
    app.get("/users", async (req, res) => {
      try {
        const users = (await usersCollection.find({}).toArray());
        res.send(users)
      }
      catch (error) {
        res.status(500).send({ message: "Failed to fetch scholarships data's" });
      }
    });

    //* Get All Scholarship Data (GET) (SCHOLARSHIP)
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

    //* Get Scholarship Data By ID (GET) (SCHOLARSHIP)
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

    //* Get Review Data By ID (GET) (REVIEW)
    app.get("/reviews/:scholarshipId", async (req, res) => {
      const scholarshipId = req.params.scholarshipId;
      try {
        const reviews = await reviewsCollection.find({ scholarshipId }).toArray();
        res.send(reviews);
      }
      catch (error) {
        res.status(500).send({ message: "Failed to fetch scholarship details" });
      }
    });

    //todo ---------------------------- STRIPE ----------------------------
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const { scholarshipId, userId, userName, userEmail, applicationFees } = req.body;
        const amount = parseInt(applicationFees) * 100;

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amount,
                product_data: {
                  name: `Scholarship Application: ${scholarshipId}`
                }
              },
              quantity: 1,
            },
          ],
          customer_email: userEmail,
          metadata: { scholarshipId, userId },
          mode: 'payment',
          success_url: `${process.env.SITE_DOMAIN}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/payment-failed`,
        });

        // Save application in DB with unpaid status
        await applicationsCollection.insertOne({
          scholarshipId,
          userId,
          userName,
          userEmail,
          applicationFees,
          paymentStatus: "unpaid",
          applicationStatus: "pending",
          applicationDate: new Date(),
        });

        res.send({ url: session.url });
      } catch (error) {
        console.log("Stripe error:", error.message);
        res.status(400).send({ error: error.message });
      }
    });

    app.get("/payment-success", async (req, res) => {
      const sessionId = req.query.session_id;
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status === "paid") {
          const { scholarshipId, userId } = session.metadata;

          // Update application status in DB
          await applicationsCollection.updateOne(
            { scholarshipId, userId },
            { $set: { paymentStatus: "paid", paymentDate: new Date() } }
          );

          return res.send("Payment Successful! You can close this page.");
        } else {
          return res.send("Payment not completed yet.");
        }
      } catch (err) {
        console.log(err);
        res.status(500).send("Server Error");
      }
    });


    //* Server Runnning MSG Console
    app.listen(port, () => console.log(`Server is running on port ${port}`));
  } catch (err) {
    console.error(err);
  }
}

run();
