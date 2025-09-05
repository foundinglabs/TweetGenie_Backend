require('dotenv').config();
const express = require("express")
const cors = require("cors")
const {OAuth2Client} = require('google-auth-library')
const {createClient} = require('@supabase/supabase-js');
const crypto = require("crypto")
const bodyparser = require ("body-parser")
const jwt = require("jsonwebtoken")

const app = express();

// const extensionOrigin = 'chrome-extension://kgklnghgifkenojladocjmlohknidcik';

// app.use(cors({
//   origin: extensionOrigin,
//   methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
//   credentials: true,
// }));



const allowedOrigins = [
  'chrome-extension://kgklnghgifkenojladocjmlohknidcik',
  'https://x.com',
  'https://twitter.com',
  'http://localhost:4000' // for testing frontend locally if needed
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS: ' + origin));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS','DELETE','PUT'],
  credentials: true
}));


const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)
// console.log(process.env.GOOGLE_CLIENT_ID)
const supabase = createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE)
// console.log(process.env.SUPABASE_URL)
// console.log(process.env.SUPABASE_SERVICE_ROLE)


app.post("/api/v1/lemonsqueezy-webhook",express.raw({ type: "*/*" }),async (req,res)=>{
    try{
        const signature = req.get("X-Signature")
        const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SIGNATURE
        console.log("signature is " ,signature)

        const rawBody = req.body;
        const digest = crypto 
                            .createHmac("sha256",secret)
                            .update(rawBody)
                            .digest("hex");

        
        if (signature !== digest) {
         console.log("❌ Invalid signature");
        return res.status(401).send("Invalid signature");
        }       
        
        const event = JSON.parse(rawBody.toString("utf8"));
        console.log("✅ Webhook received:", event.meta.event_name);
        // res.json({event})

        if (event.meta.event_name === "subscription_payment_success" && event.data.attributes.status === "paid"){
           let {data:user ,error } = await supabase .from ("Users") .select("*") .eq("email",event.data.attributes.user_email) .single();
            
           if(!user){
            const{data :newUser , error:insertError} = await supabase 
            .from ("Users") .insert([{"name": event.data.attributes.user_name , "email" : event.data.attributes.user_email}]) .select() .single();

            if (insertError ) throw insertError ;
            user = newUser
           }
           console.log(user)
           const today = new Date().toISOString().split('T')[0];

           const createdAtRaw = event.data.attributes.created_at;
           const createdAt = new Date(createdAtRaw);

           // Add 30 days for expiry (adjust days as needed)
           const expiresAt = new Date(createdAt);
           expiresAt.setDate(expiresAt.getDate() + 30);
           const expiresAtFormatted = expiresAt.toISOString().split('T')[0];

           const {data : insertPro, error : InsertProError} = await supabase .from("Users") .update({"is_premium" : true,"premium_date" : today}) .eq("id",user.id) .select() .single();
           if(InsertProError) throw InsertProError

           
           const{data : Subscription , error:SubscriptionError} = await supabase .from("subscription") .upsert({"user_id" : user.id,
                                                                                                                 "ls_id" : event.data.id,
                                                                                                                 "status":event.data.attributes.status,
                                                                                                                 "store_id" :event.data.attributes.store_id,
                                                                                                                 "user_name" : event.data.attributes.user_name,
                                                                                                                 "card_brand" : event.data.attributes.card_brand ,
                                                                                                                 "card_last_four" : event.data.attributes.card_last_four,
                                                                                                                 "user_email" : event.data.attributes.user_email,
                                                                                                                 "customer_id" : event.data.attributes.customer_id,
                                                                                                                 "subscription_id" : event.data.attributes.subscription_id,
                                                                                                                 "subtotal": event.data.attributes.subtotal,
                                                                                                                 
                                                                                                                 "webhook_id": event.meta.webhook_id,
                                                                                                                 "created_at" : event.data.attributes.created_at,
                                                                                                                 "expires_at" : expiresAtFormatted
                                                                                                                },{onConflict :"subscription_id"}) .select() .single();

            if(SubscriptionError) throw SubscriptionError
            
            
            console.log("User Subscription Updated ")
        }

        res.json({message : "Callback handled Successfully",
                    eventdata : event
        })

    }catch(e){
        console.log("error handling Webhook",e.message);
        res.status(500).json({message : "Error Occurred on Webhook handling"})
    }
})

app.use(express.json());



app.post("/api/auth/google",async (req ,res)=>{
    const {id_token,access_token} = req.body
    console.log(id_token)
    console.log(` accesstoken - ${access_token}`)
    if(!id_token) return res.status(400).json({error:"ID token is required"});
    if(!access_token) return res.status(400).json({error:"Access token is required"});

    try{
        const ticket = await client.verifyIdToken({
            idToken : id_token,
            audience: process.env.GOOGLE_CLIENT_ID
        });

        const payload = ticket.getPayload();
        //  console.log(payload)
        const {sub:google_id,email} =payload 

         const getName = await fetch(process.env.GOOGLE_OAUTH_URL, {
            headers: {
                Authorization: `Bearer ${access_token}`
            }
        });

        const userInfo = await getName.json();
        const {name,picture} = userInfo
        console.log(` Name is ${name} and picture is ${picture}`)

        let {data:user ,error } = await supabase .from ("Users") .select("*") .eq("email",email) .single();

        if(!user){
            const{data :newUser , error:insertError} = await supabase 
            .from ("Users") .insert([{google_id, name , email}]) .select() .single();

            if (insertError ) throw insertError ;
            user = newUser
        }

        // const token = jwt.sign({userId : user.id},process.env.JWT_SECRET,{
        //     expiresIn : "1d"
        // })
        const today = new Date().toISOString().slice(0,10)

        let {count,error:todayError} = await supabase
                                         .from("usage_aggregate")
                                        .select("user_id", { count: "exact" })
                                        .eq("user_id", user.id)
                                        
                                        .eq("is_used" ,true);

         if (todayError) {
      return res.status(500).json({ error: error.message });
      }

      let repliesToday = count || 0;
      let quota ;
      if(user.is_premium){
        quota = null
      }else {
        quota = 50
      }

      const replies_left_today = quota === null ? null :  Math.max(0, quota - repliesToday);
      // const replies_left_today =  Math.max(0, quota - repliesToday);

        // const { count: totalReplies, error: totalError } = await supabase
        // .from("usage_aggregate")
        // .select("*", { count: "exact", head: true })
        // .eq("user_id", user.id)
        // .eq("is_used", true);

        // if (totalError) {
        // return res.status(500).json({ error: totalError.message });
        // } 
        let Total_replies = quota; 

      
        res.json({user,repliesToday,replies_left_today,Total_replies})
    }catch(e){
        console.error(e)
        res.status(401).json({error : "Authentication failed "})
    }
})

async function getuser(req){
    if(req.headers["google_id"]){
        const {data:user , error}= await supabase .from("Users") .select("*") .eq("google_id",req.headers["google_id"]) .single();
        if (error) throw error;
        return user
    }else if(req.headers["anonymous_token"]){
        let {data:user , error} = await supabase .from("Users") .select("*") .eq("anonymous_token",req.headers["anonymous_token"]) .single();
        if (!user){
            const { data: newUser, error } = await supabase .from("Users") .insert([{"anonymous_token": req.headers["anonymous_token"],"is_anonymous":true,"name":"Anonymous" }]) .select() .single();
            if (error) throw error
            return newUser
        }
        return user
    }
    throw new Error ("No Google Id or Anonymous Token Provided ")
}

function getQuota(user) {
  if (user.is_premium) return null;      // Unlimited
  if (user.google_id) return 50;     // Logged in
  return 5;                          // Anonymous
}


app.post("/api/ai/generateReply",async(req,res)=>{
    const {TweetText} = req.body
    console.log(TweetText);
    console.log(req.headers["anonymous_token"])
    // console.log(req.headers["google_id"])
    let user;
    try {
       user = await getuser(req);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const today = new Date().toISOString().slice(0,10)

    let {count,error} = await supabase
                                            .from("usage_aggregate")
                                            .select("*", { count: "exact" ,head:true })
                                            .eq("user_id", user.id)
                                            .eq("is_used" ,true);

    // if(!usageStats || usageStats.length === 0){
    //     usageStats = await supabase .from("usage_aggregate") .insert([{"user_id":user.id,"Date":today,"is_used": false}])
    //     count= 0;
    // }
    if (error) {
      return res.status(500).json({ error: error.message });
    }

    let repliesToday = count || 0;

    const quota = getQuota(user)

    if(quota == null ){
      const expiry = await supabase .from("subscription") .select("expires_at") .eq("user_id",user.id)
      const expiryDate = new Date(expiry);
      const now = new Date();
      if(expiryDate < now){
         return res.status(429).json({
            error : "Subscription Ended"
        })
      }
    }

    if (quota !== null && repliesToday >= quota){
        return res.status(429).json({
            error : "Daily Limit exceeds"
        })
    }
      const ApiCall = await fetch(process.env.AI_REPLY_URL, {
                method: "POST",
                headers: {
                    "api_key":process.env.LLM_API_KEY,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    "model": "openai/gpt-4o-mini",
                    "messages": [
                    {
                        "role": "system",
                        "content": "Generate SHORT Twitter replies. Maximum 100 characters. Be casual, natural. One sentence only. No explanations."
                    },{
                        "role": "user",
                        "content": TweetText
                    }
                    ]
                })
                });


    const data = await ApiCall.json();
    let message = data.choices[0].message.content.trim();


    if(!message){
        res.status(400).json({
            error : "Message didn't come from LLM"
        })
     }
    
    // Aggressive character limit - much shorter
    if (message.length > 120) {
        message = message.substring(0, 100).trim();
        // Remove incomplete words/sentences
        message = message.replace(/[.!?]*\s*$/, '');
        if (message.includes('.')) {
            message = message.split('.')[0] + '.';
        }
    }

    repliesToday += 1;
    let is_anonymous ;

    if(quota==5){
        is_anonymous = true
    }else{
       is_anonymous= false
    };

    await supabase .from("usage_aggregate") .insert([{"user_id":user.id,"date":today,"is_used":true,"is_anonymous":is_anonymous}])
    const replies_left_today = quota === null ? null :  Math.max(0, quota - repliesToday);

    // const { count: totalReplies, error: totalError } = await supabase
    //     .from("usage_aggregate")
    //     .select("*", { count: "exact", head: true })
    //     .eq("user_id", user.id)
    //     .eq("is_used", true);

    //  if (totalError) {
    //    return res.status(500).json({ error: totalError.message });
    //  }   

    let totalReplies = quota

        console.log(repliesToday)
        console.log(replies_left_today)
        console.log(totalReplies)
    res.json({
        reply : message,
        replies_today : repliesToday,
        replies_left_today : replies_left_today,
        total_replies : totalReplies
    })
   
})

app.post("/api/purchaseProduct",async (req,res)=>{
    try{
        const {productId} = req.body
        
        if(!productId){
            return res.status(400).json({message : "Product Id id required"})
        }

       
        const response = await fetch(process.env.LEMON_SQUEEZY_URL
          ,
          {
            method: "POST",
            headers: {
              Accept: "application/vnd.api+json",
              "Content-Type": "application/vnd.api+json",
              Authorization: `Bearer ${process.env.LEMON_SQUEEZY_API_KEY_REAL}`,
            },
            body: JSON.stringify({
              data: {
                type: "checkouts",
                attributes: {
                  product_options: {
                    redirect_url: `${process.env.REDIRECT_URL}/verifylemonsqueezy?order_id=[order_id]`,
                  },
                },
                relationships: {
                  store: {
                    data: {
                      type: "stores",
                      id: process.env.LEMON_SQUEEZY_STORE_ID,
                    },
                  },
                  variant: {
                    data: {
                      type: "variants",
                      id: productId,
                    },
                  },
                },
              },
            }),
          }
        );

        const result = await response.json()
        const checkoutUrl = result.data.attributes.url
        res.json({checkoutUrl : checkoutUrl})


    }catch(e){
        console.log(e);
        res.status(500).json({
            message : "An Error Occurred"
        })
    }
})

// app.get("/api/checksubscription",async (req,res)=>{
//     let user;
//     try {
//        user = await getuser(req);
//     } catch (err) {
//       return res.status(400).json({ error: err.message });
//     }
//     console.log("get request for DOM Content Hit")
//     res.status(200).json({user : user})
// })

app.get("/checking",async (req,res)=>{
  const{word} = req.body
  res.json({"message" : word})
})

app.get("/verifylemonsqueezy", async (req,res)=>{
  const {order_id} = req.query
  try{

    if(order_id){
      const response = await fetch(`${process.env.LEMON_SQUEEZY_BACKEND_URL}/orders/${order_id}`,{
        method : "GET" ,
       headers: {
              Accept: "application/vnd.api+json",
              "Content-Type": "application/vnd.api+json",
              Authorization: `Bearer ${process.env.LEMON_SQUEEZY_API_KEY_REAL}`,
            },
    })

      const result = await response.json();
      let status = result.data.attributes.status

      if (status == "paid"){
        res.redirect(process.env.SUCCESS_PAGE_URL)
      }else{
        res.redirect(process.env.FAILED_PAGE_URL)
      }

    }else{
      console.log("Order Id not Found")
    }
  }catch(e){
    console.log("verification failed")
    res.json({"message" : e})
  }
})





const Port = process.env.PORT
app.listen(Port,()=>{
    console.log("Server is running on port",Port)
})