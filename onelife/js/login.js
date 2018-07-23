$(document).ready(function() { 
  //我写的验证码 
  //验证码 
  var code; 
  function createCode(){ 
    code = '';//首先默认code为空字符串 
    var codeLength = 4;//设置长度，这里看需求，我这里设置了4 
    var codeV = $(".code"); 
    //设置随机字符 
    var random = new Array(0,1,2,3,4,5,6,7,8,9,'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R', 'S','T','U','V','W','X','Y','Z'); 
    for(var i = 0; i < codeLength; i++){ //循环codeLength 我设置的4就是循环4次   
       var index = Math.floor(Math.random()*36); //设置随机数范围,这设置为0 ~ 36  
       code += random[index]; //字符串拼接 将每次随机的字符 进行拼接 
     } 
    codeV.text(code);//将拼接好的字符串赋值给展示的Value 
  } 
  //页面开始加载验证码 
  createCode(); 
  //验证码Div加载点击事件 
  $(".code").bind('click',function() { 
    createCode(); 
  }); 
  //下面就是判断是否==的代码，无需解释 
  $(".register_btn").bind('click',function() { 
    var oValue = $(".code_input").val().toUpperCase(); 
    var username = $(".register_usnm").val();
    var password = $(".register_pwd").val();
    if(username == "") {
      showMessage("请输入账号",3000,true,'bounceInUp-hastrans','bounceOutDown-hastrans');
    }else if(password == "") {
      showMessage("请输入密码",3000,true,'bounceInUp-hastrans','bounceOutDown-hastrans');
    }else if(oValue ==""){ 
      showMessage('请输入验证码',3000,true,'bounceInUp-hastrans','bounceOutDown-hastrans');
    }else if(oValue != code){ 
      showMessage('验证码不正确，请重新输入',3000,true,'bounceInUp-hastrans','bounceOutDown-hastrans');
      oValue = ""; 
      createCode(); 
    }else if(username !="" && password !=""){
      showMessage('注册功能无法实现，node还没学，接口不会写^_^',6000,true,'bounceInUp-hastrans','bounceOutDown-hastrans')
  } 
});  
});

//登录页面点击注册
$(".link").on("click",function() {
  $(".login").hide();
  $(".register").show();
}) 
// 注册页面点击返回登录
$(".return").on("click",function() {
  $(".login").show();
  $(".register").hide();
})

// 点击登录验证
$("#login").on("click",function() {
  var username = $(".username").val();
  var password = $(".password").val();
  if(username == "") {
    showMessage("请输入账号",3000,true,'bounceInUp-hastrans','bounceOutDown-hastrans');
  }else if(password == "") {
    showMessage("请输入密码",3000,true,'bounceInUp-hastrans','bounceOutDown-hastrans');
  }else if(username !="" && password !="") {
    if(username == "admin" && password == "admin"){
      $(location).attr('href', './index.html');
    }else {
      showMessage('账号或密码不正确，请重新输入',3000,true,'bounceInUp-hastrans','bounceOutDown-hastrans');
    }
    // $.post('url', {username:username, password:password}, function(){

    // })
  }else {
    showMessage("异常！！！",6000,true,'bounceInUp-hastrans','bounceOutDown-hastrans');
  }
})

// 注册验证
$("#register").on("click", function() {

})