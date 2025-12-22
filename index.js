const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

//* FIREBASE ADMIN SDK
const admin = require("firebase-admin");

// const serviceAccount = require("./firebase-adminsdk.json");
const decoded = Buffer.from(process.env.FIREBASE_SERVICE_KEY, "base64").toString("utf8");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

dotenv.config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_API);

const app = express();
const port = process.env.PORT || 3000;

//* MIDDLEWARE
app.use(cors());
app.use(express.json());

//* MONGODB
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

    //* JWT VERIFICATION MIDDLEWARE
    const verifyFirebaseToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;

      if (!authHeader) {
        return res.status(401).send({ message: "Unauthorized access" });
      }

      const token = authHeader.split(" ")[1];

      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded_email = decoded.email;
        req.decoded_uid = decoded.uid;   // ✅ added
        next();
      } catch (error) {
        return res.status(401).send({ message: "Invalid token" });
      }
    };

    //* ADMIN MIDDLEWARE
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await usersCollection.findOne({ email });

      if (!user || user.role !== "Admin") {
        return res.status(403).send({ message: "Forbidden access" });
      }

      next();
    };

    //* MODERATOR/ADMIN MIDDLEWARE
    const verifyModeratorOrAdmin = async (req, res, next) => {
      const email = req.decoded_email;
      const user = await usersCollection.findOne({ email });

      if (!user || (user.role !== "Moderator" && user.role !== "Admin")) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      next();
    };
    //todo ---------------------------- TESTING ROUTES ----------------------------
    app.get("/", (req, res) => res.send("Server is running!"));

    //todo ---------------------------- USER RELATED ROUTES ----------------------------
    //* Sending Register User Details to DB (POST) (USER INFO) (USER)
    app.post("/users", async (req, res) => {
      const user = req.body;
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) return res.send({ message: "User Exists" });
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    //* Get All Users Data (GET) (USER)
    app.get("/users",verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const users = (await usersCollection.find({}).toArray());
        res.send(users)
      }
      catch (error) {
        res.status(500).send({ message: "Failed to fetch scholarships data's" });
      }
    });

    //* Get user role by email (ALL)
    app.get("/users/role/:email", verifyFirebaseToken, async (req, res) => {
      // console.log("ROLE API HIT:", req.params.email);
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });

      if (!user) {
        return res.status(404).send({ role: "Student" });
      }

      res.send({ role: user.role });
    });

    //* Change user role (ADMIN)
    app.patch("/users/role/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      const allowedRoles = ["Student", "Moderator", "Admin"];
      if (!allowedRoles.includes(role)) {
        return res.status(400).send({ message: "Invalid role" });
      }

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { role } }
      );

      res.send({ message: "Role updated successfully" });
    });

    //* Delete user (ADMIN)
    app.delete("/users/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;

      const user = await usersCollection.findOne({ _id: new ObjectId(id) });

      if (!user) {
        return res.status(404).send({ message: "User not found" });
      }

      // Optional safety (recommended)
      if (user.role === "Admin") {
        return res.status(403).send({ message: "Cannot delete admin" });
      }

      await usersCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ message: "User deleted successfully" });
    });

    //todo ---------------------------- SCHOLARSHIP RELATED ROUTES ----------------------------
    //* Add Scholarship (ADMIN)
    app.post("/scholarships", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const scholarship = {
        ...req.body,
        createdAt: new Date(),
      };

      const result = await allScholarshipCollection.insertOne(scholarship);
      res.send({ message: "Scholarship added successfully", id: result.insertedId });
    });

    //* Get All Scholarship with search, filter, sort, pagination (SCHOLARSHIP)
    app.get("/scholarships", async (req, res) => {
      try {
        const { search, category, country, sortBy, order, page, limit } = req.query;

        const query = {};

        if (search) {
          query.$or = [
            { scholarshipName: { $regex: search, $options: "i" } },
            { universityName: { $regex: search, $options: "i" } },
            { degree: { $regex: search, $options: "i" } },
          ];
        }

        if (category) query.scholarshipCategory = category;
        if (country) query.universityCountry = country;

        let sortQuery = {};
        if (sortBy) {
          sortQuery[sortBy] = order === "asc" ? 1 : -1;
        } else {
          sortQuery = { createdAt: -1 }; // default newest first
        }

        const pageNum = parseInt(page) || 1;
        const pageLimit = parseInt(limit) || 10;
        const skip = (pageNum - 1) * pageLimit;

        const totalDocs = await allScholarshipCollection.countDocuments(query);

        const scholarships = await allScholarshipCollection
          .find(query)
          .sort(sortQuery)
          .skip(skip)
          .limit(pageLimit)
          .toArray();

        res.send({
          total: totalDocs,
          page: pageNum,
          limit: pageLimit,
          scholarships,
        });
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch scholarships" });
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

    //* Update Scholarship Data (SCHOLARSHIP)
    app.patch("/scholarships/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const updatedData = req.body;

      await allScholarshipCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );

      res.send({ message: "Scholarship updated successfully" });
    });

    //* Delete Scholarship Data (SCHOLARSHIP)
    app.delete("/scholarships/:id", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;

      await allScholarshipCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ message: "Scholarship deleted successfully" });
    });

    //todo ---------------------------- APPLICATIONS RELATED ROUTES ----------------------------
    //* Get ALL Application (MODERATOR/ADMIN)
    app.get("/applications", verifyFirebaseToken, verifyModeratorOrAdmin, async (req, res) => {
      try {
        const applications = await applicationsCollection.find({}).sort({ applicationDate: -1 }).toArray();
        res.send(applications);
      }
      catch (error) {
        console.error(error);
        res.status(500).send({ message: "Failed to fetch applications" });
      }
    });

    //* Update Application Status (MODERATOR)
    app.patch("/applications/status/:id", verifyFirebaseToken, verifyModeratorOrAdmin, async (req, res) => {
      const { id } = req.params;
      const { applicationStatus } = req.body;

      const allowedStatus = ["processing", "completed", "rejected"];
      if (!allowedStatus.includes(applicationStatus)) {
        return res.status(400).send({ message: "Invalid status" });
      }

      const result = await applicationsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { applicationStatus } }
      );

      res.send({ message: "Status updated" });
    });

    //* Add / Update Feedback (MODERATOR)
    app.put("/applications/feedback/:id", verifyFirebaseToken, verifyModeratorOrAdmin, async (req, res) => {
      const { id } = req.params;
      const { feedback } = req.body;

      const result = await applicationsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { feedback } }
      );

      res.send({ message: "Feedback updated" });
    });

    //* Get Application by user email (STUDENT)
    app.get("/applications/user/:email", verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;

      if (req.decoded_email !== email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      try {
        const applications = await applicationsCollection
          .find({ userEmail: email })
          .sort({ applicationDate: 1 })
          .toArray();

        const populatedApps = await Promise.all(
          applications.map(async (app) => {
            const scholarship = await allScholarshipCollection.findOne({
              _id: new ObjectId(app.scholarshipId),
            });

            return {
              ...app,
              scholarshipName: scholarship?.scholarshipName || "Unknown",
              universityName: scholarship?.universityName || "Unknown",
              universityCity: scholarship?.universityCity || "",
              universityCountry: scholarship?.universityCountry || "",
              subjectCategory: scholarship?.subjectCategory || "",
            };
          })
        );

        res.send(populatedApps);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch user applications" });
      }
    });

    //* Update Application by ID (STUDENT)
    app.put("/applications/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;

      try {
        const application = await applicationsCollection.findOne({
          _id: new ObjectId(id),
        });

        if (!application) {
          return res.status(404).send({ message: "Application not found" });
        }

        // ownership check
        if (application.userEmail !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        // status check
        if (application.applicationStatus !== "pending") {
          return res
            .status(403)
            .send({ message: "Cannot update processed application" });
        }

        await applicationsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );

        res.send({ message: "Application updated successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to update application" });
      }
    });

    //* Delete Application (STUDENT)
    app.delete("/applications/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;

      const application = await applicationsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!application) {
        return res.status(404).send({ message: "Application not found" });
      }

      // ownership check
      if (application.userEmail !== req.decoded_email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      // status rule
      if (application.applicationStatus !== "pending") {
        return res
          .status(403)
          .send({ message: "Cannot delete processed application" });
      }

      await applicationsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send({ message: "Application deleted successfully" });
    });

    //todo ---------------------------- REVIEW RELATED ROUTES ----------------------------
    //* Get ALL Reviews (MODERATOR/ADMIN)
    app.get("/reviews", verifyFirebaseToken, verifyModeratorOrAdmin, async (req, res) => {
      try {
        const reviews = await reviewsCollection.find({}).sort({ reviewDate: -1 }).toArray();
        res.send(reviews);
      }
      catch (error) {
        res.status(500).send({ message: "Failed to fetch reviews" });
      }
    });

    //* Get Review Data By ID (REVIEW)
    app.get("/reviews/:scholarshipId", async (req, res) => {
      const scholarshipId = req.params.scholarshipId;

      try {
        const reviews = await reviewsCollection.find({ scholarshipId }).toArray();
        res.send(reviews);
      } catch (error) {
        res.status(500).send({ message: "Failed to fetch scholarship reviews" });
      }
    });

    //* Get Review by user EMAIL (REVIEW)
    app.get("/reviews/user/:email", verifyFirebaseToken, async (req, res) => {
      const email = req.params.email;

      // ownership check
      if (req.decoded_email !== email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      try {
        const reviews = await reviewsCollection.find({ userEmail: email }).toArray();
        res.send(reviews);
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to fetch user reviews" });
      }
    });

    //* Add Review (STUDENT)
    app.post("/reviews", verifyFirebaseToken, async (req, res) => {
      const {
        scholarshipId,
        scholarshipName,
        universityName,
        ratingPoint,
        reviewComment,
      } = req.body;

      if (!scholarshipId || !ratingPoint || !reviewComment) {
        return res.status(400).send({ message: "Missing required fields" });
      }

      try {
        const newReview = {
          scholarshipId,
          scholarshipName,
          universityName,
          ratingPoint,
          reviewComment,
          userEmail: req.decoded_email,
          userId: req.decoded_uid,
          reviewDate: new Date(),
        };

        const result = await reviewsCollection.insertOne(newReview);
        res.send({ message: "Review added successfully", reviewId: result.insertedId });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to add review" });
      }
    });

    //* Update Review (REVIEW)
    app.put("/reviews/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;
      const { reviewComment, ratingPoint } = req.body;

      if (!reviewComment || !ratingPoint) {
        return res.status(400).send({ message: "Review comment and rating are required" });
      }

      try {
        const review = await reviewsCollection.findOne({ _id: new ObjectId(id) });

        if (!review) {
          return res.status(404).send({ message: "Review not found" });
        }

        // ownership check
        if (review.userEmail !== req.decoded_email) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        await reviewsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { reviewComment, ratingPoint, updatedAt: new Date() } }
        );

        res.send({ message: "Review updated successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to update review" });
      }
    });

    //* Delete Review (REVIEW)
    app.delete("/reviews/:id", verifyFirebaseToken, async (req, res) => {
      const { id } = req.params;

      try {
        const review = await reviewsCollection.findOne({ _id: new ObjectId(id) });
        if (!review) {
          return res.status(404).send({ message: "Review not found" });
        }

        const user = await usersCollection.findOne({ email: req.decoded_email });

        const isOwner = review.userEmail === req.decoded_email;
        const isModeratorOrAdmin = user?.role === "Moderator" || user?.role === "Admin";

        if (!isOwner && !isModeratorOrAdmin) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        await reviewsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ message: "Review deleted successfully" });
      } catch (err) {
        console.error(err);
        res.status(500).send({ message: "Failed to delete review" });
      }
    });

    //todo ---------------------------- ANALYTICS RELATED ROUTES ----------------------------
    //* Admin Analytics Stats
    app.get("/admin-stats", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments();
        const totalScholarships = await allScholarshipCollection.countDocuments();

        const payments = await applicationsCollection
          .aggregate([
            {
              $group: {
                _id: null,
                totalFees: {
                  $sum: {
                    $add: ["$applicationFees", "$serviceCharge"],
                  },
                },
              },
            },
          ])
          .toArray();

        const totalFeesCollected = payments[0]?.totalFees || 0;

        res.send({
          totalUsers,
          totalScholarships,
          totalFeesCollected,
        });
      } catch (error) {
        res.status(500).send({ message: "Failed to load admin stats" });
      }
    });

    //* Applications By Scholarship Category
    app.get("/analytics/applications-by-category", verifyFirebaseToken, verifyAdmin, async (req, res) => {
      try {
        const result = await applicationsCollection
          .aggregate([
            {
              $group: {
                _id: "$scholarshipCategory",
                count: { $sum: 1 },
              },
            },
          ])
          .toArray();

        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to load analytics data" });
      }
    });

    //todo ---------------------------- STRIPE ----------------------------
    //* Route For Payment
    app.post("/create-checkout-session", verifyFirebaseToken, async (req, res) => {
      try {
        const { scholarshipId, applicationFees } = req.body;

        const userId = req.decoded_uid;
        const userEmail = req.decoded_email;

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
    app.get("/payment-success", verifyFirebaseToken, async (req, res) => {
      const { session_id } = req.query;

      try {
        const session = await stripe.checkout.sessions.retrieve(session_id);

        if (session.payment_status !== "paid") {
          return res.status(400).send({ message: "Payment not completed" });
        }

        const { scholarshipId, userId, userEmail, applicationFees } = session.metadata;

        // ownership check
        if (userEmail !== req.decoded_email || userId !== req.decoded_uid) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const scholarship = await allScholarshipCollection.findOne({
          _id: new ObjectId(scholarshipId),
        });

        if (!scholarship) {
          return res.status(404).send({ message: "Scholarship not found" });
        }

        const applicationData = {
          scholarshipId,
          userId,
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
          feedback: "",
        };

        await applicationsCollection.updateOne(
          { scholarshipId, userId },
          { $set: applicationData },
          { upsert: true }
        );

        res.send({
  scholarshipName: scholarship.scholarshipName,
  universityName: scholarship.universityName,
  amountPaid: applicationFees,
  transactionId: session.payment_intent,
});
      } catch (error) {
        console.error(error);
        res.status(500).send({ message: "Payment verification failed" });
      }
    });

    //* Payment Cancelled Route
    app.get("/payment-cancelled", verifyFirebaseToken, async (req, res) => {
      const { session_id } = req.query;

      try {
        const session = await stripe.checkout.sessions.retrieve(session_id);

        const { scholarshipId, userId, userEmail, applicationFees } = session.metadata;

        // ownership check
        if (userEmail !== req.decoded_email || userId !== req.decoded_uid) {
          return res.status(403).send({ message: "Forbidden access" });
        }

        const scholarship = await allScholarshipCollection.findOne({
          _id: new ObjectId(scholarshipId),
        });

        if (!scholarship) {
          return res.status(404).send({ message: "Scholarship not found" });
        }

        const applicationData = {
          scholarshipId,
          userId,
          userEmail,
          universityName: scholarship.universityName,
          scholarshipCategory: scholarship.scholarshipCategory,
          degree: scholarship.degree,
          applicationFees: Number(applicationFees),
          serviceCharge: scholarship.serviceCharge || 0,
          paymentStatus: "unpaid",
          applicationStatus: "pending",
          applicationDate: new Date(),
          feedback: "",
        };

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
  }
  catch (err) {
    console.error(err);
  }
}

run();
