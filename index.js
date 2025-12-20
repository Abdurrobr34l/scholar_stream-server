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

    //* Get user role by email
    app.get("/users/role/:email", async (req, res) => {
      // console.log("ROLE API HIT:", req.params.email);
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ role: "Student" });
      }

      res.send({ role: user.role });
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

    //* Get applications by user email (GET) (APPLICATIONS)
    app.get("/applications/user/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const applications = await applicationsCollection.find({ userEmail: email }).toArray();

        const populatedApps = await Promise.all(applications.map(async (app) => {
          const scholarship = await allScholarshipCollection.findOne({ _id: new ObjectId(app.scholarshipId) });
          return {
            ...app,
            scholarshipName: scholarship?.scholarshipName || "Unknown",
            universityName: scholarship?.universityName || "Unknown",
            universityCity: scholarship?.universityCity || "",
            universityCountry: scholarship?.universityCountry || "",
            subjectCategory: scholarship?.subjectCategory || "",
          };
        }));

        res.send(populatedApps);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch user applications" });
      }
    });

    //* Delete Application (DELETE)
    app.delete("/applications/:id", async (req, res) => {
      const { id } = req.params;

      const application = await applicationsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!application) {
        return res.status(404).send({ message: "Application not found" });
      }

      // Security rule (assignment-safe)
      if (application.applicationStatus !== "pending") {
        return res
          .status(403)
          .send({ message: "Cannot delete processed application" });
      }

      await applicationsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ message: "Application deleted successfully" });
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

    //* Get reviews by user EMAIL (GET) (REVIEW)
    app.get("/reviews/user/:email", async (req, res) => {
      const email = req.params.email;
      try {
        const reviews = await reviewsCollection.find({ userEmail: email }).toArray();
        res.send(reviews);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch user reviews" });
      }
    });

    //* Update Review (PUT)
    app.put("/reviews/:id", async (req, res) => {
      const { id } = req.params;
      const { reviewComment, ratingPoint } = req.body;

      if (!reviewComment || !ratingPoint) {
        return res.status(400).send({ message: "Review comment and rating are required" });
      }

      try {
        const result = await reviewsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { reviewComment, ratingPoint, updatedAt: new Date() } }
        );

        if (result.modifiedCount === 0) {
          return res.status(404).send({ message: "Review not found or not modified" });
        }

        res.send({ message: "Review updated successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to update review" });
      }
    });

    //todo ---------------------------- STRIPE ----------------------------
    app.post("/create-checkout-session", async (req, res) => {
      try {
        const { scholarshipId, userId, userName, userEmail, applicationFees } = req.body;

        const amount = Number(applicationFees) * 100;

        const session = await stripe.checkout.sessions.create({
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: "usd",
                unit_amount: amount,
                product_data: {
                  name: "Scholarship Application Fee",
                },
              },
              quantity: 1,
            },
          ],
          mode: "payment",

          customer_email: userEmail,

          metadata: {
            scholarshipId,
            userId,
            userName,
            userEmail,
            applicationFees,
          },

          success_url: `${process.env.SITE_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.SITE_DOMAIN}/dashboard/payment-cancelled?session_id={CHECKOUT_SESSION_ID}`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Checkout session failed" });
      }
    });

    //* Payment Success Route
    app.get("/payment-success", async (req, res) => {
      const { session_id } = req.query;

      try {
        const session = await stripe.checkout.sessions.retrieve(session_id);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ message: "Payment not completed" });
        }

        const { scholarshipId, userId, userName, userEmail, applicationFees } = session.metadata;

        // Fetch scholarship details
        const scholarship = await allScholarshipCollection.findOne({
          _id: new ObjectId(scholarshipId),
        });

        if (!scholarship) {
          return res.status(404).send({ message: "Scholarship not found" });
        }

        const applicationData = {
          scholarshipId,
          userId,
          userName,
          userEmail,
          universityName: scholarship.universityName,
          scholarshipCategory: scholarship.scholarshipCategory,
          degree: scholarship.degree,
          applicationFees: Number(applicationFees),
          serviceCharge: scholarship.serviceCharge || 0,
          paymentStatus: "paid",
          applicationStatus: "submitted",
          applicationDate: new Date(),
          paymentDate: new Date(),
          transactionId: session.payment_intent,
          feedback: "", // Moderator will add later
        };

        // Upsert application
        await applicationsCollection.updateOne(
          { scholarshipId, userId },
          { $set: applicationData },
          { upsert: true }
        );

        // Redirect back to dashboard
        res.redirect(`${process.env.SITE_DOMAIN}/dashboard/my-applications`);
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Payment verification failed" });
      }
    });

    //* Payment Cancelled Route
    app.get("/payment-cancelled", async (req, res) => {
      const { session_id } = req.query;

      try {
        const session = await stripe.checkout.sessions.retrieve(session_id);

        const { scholarshipId, userId, userName, userEmail, applicationFees } = session.metadata;

        // Fetch scholarship details
        const scholarship = await allScholarshipCollection.findOne({
          _id: new ObjectId(scholarshipId),
        });

        if (!scholarship) {
          return res.status(404).send({ message: "Scholarship not found" });
        }

        const applicationData = {
          scholarshipId,
          userId,
          userName,
          userEmail,
          universityName: scholarship.universityName,
          scholarshipCategory: scholarship.scholarshipCategory,
          degree: scholarship.degree,
          applicationFees: Number(applicationFees),
          serviceCharge: scholarship.serviceCharge || 0,
          paymentStatus: "unpaid",
          applicationStatus: "pending",
          applicationDate: new Date(),
          feedback: "", // Moderator will add later
        };

        // Upsert application (prevent duplicates)
        await applicationsCollection.updateOne(
          { scholarshipId, userId },
          { $setOnInsert: applicationData },
          { upsert: true }
        );

        res.send({
          scholarshipName: scholarship.scholarshipName,
          error: "Payment was cancelled by the user",
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({
          scholarshipName: "",
          error: "Payment cancellation failed",
        });
      }
    });


    //* Server Runnning MSG Console
    app.listen(port, () => console.log(`Server is running on port ${port}`));
  } catch (err) {
    console.error(err);
  }
}

run();
