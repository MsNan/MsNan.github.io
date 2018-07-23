$(".left").on('click', function() {
	top.location.href='../index.html'; 
	$(this).addClass('checked');
	$('.right').removeClass('checked');
	return false;
})
$(".right").on('click', function() {
	top.location.href='../my.html'; 
	$(this).addClass('checked');
	$('.left').removeClass('checked');
	return false;
})