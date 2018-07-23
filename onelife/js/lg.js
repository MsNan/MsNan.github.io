$(".login .send-button input").click(function(){
	if($(".login input[name='Userame']").val()=='admin' && $(".login input[name='Password']").val()=='admin'){
		alert("登录成功！");
	}else if($(".login input[name='Userame']").val()=='' || $(".login input[name='Password']").val()==''){
		alert("用户名或密码不能为空！");
		return false;
	}else{
		alert("用户名或密码错误！");
		return false;
	}
})

$(".register .send-button input").click(function(){
	var reg = /^\w+((-\w+)|(\.\w+))*\@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z0-9]+$/;
	var email = $(".register input[name='Email']").val();
	isok= reg.test(email );
	if($(".register input[name='Name']").val()=='' || $(".register input[name='Email']").val()=='' || $(".register input[name='Password']").val()=='' || $(".register input[name='Phone Number']").val()==''){
		alert("请完善信息！");
		return false;
	}
	else if($(".register input[name='Name']").val().length<2){
		alert("用户名大于两个字符");
		return false;
	}
	else if(!isok){
		alert("邮箱格式不正确，请重新输入！");
		return false;
	}
	else if($(".register input[name='Password']").val().length<8){
		alert("密码必须大于8位");
		return false;
	}
	else if(!$(".register input[name='Phone Number']").val().match(/^(((13[0-9]{1})|159|153)+\d{8})$/)){
		alert("手机号码格式不正确，请重新输入！");
		return false;
	}
	else{
		alert("注册成功！");
	}
});